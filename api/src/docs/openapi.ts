import { applyDecorators, type INestApplication } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
  DocumentBuilder,
  SwaggerModule,
} from '@nestjs/swagger';

/** Swagger UI en /docs y el JSON OpenAPI en /docs/json. */
export function setupDocs(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Órbita Balance API')
    .setDescription(
      'API de saldo, depósitos, retiros y webhook de la pasarela de pagos. Montos en USD como texto (ej. "150.25").',
    )
    .setVersion('1.0.0')
    .addServer('http://localhost:3000', 'Local')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearerAuth')
    .addApiKey(
      { type: 'apiKey', in: 'header', name: 'X-Signature', description: 'Firma HMAC del body crudo con WEBHOOK_SECRET.' },
      'webhookSignature',
    )
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs/json',
  });
}

interface RouteDocs {
  tags: string[];
  summary: string;
  description?: string;
  security?: Record<string, string[]>[];
  headers?: { required?: string[]; properties: Record<string, any> };
  querystring?: { properties: Record<string, any> };
  body?: object;
  response: Record<number, any>;
}

/** Convierte los esquemas JSON de este archivo en decoradores de @nestjs/swagger. */
export function ApiDocs(s: RouteDocs): MethodDecorator & ClassDecorator {
  const decorators = [ApiTags(...s.tags), ApiOperation({ summary: s.summary, description: s.description })];

  for (const sec of s.security ?? []) {
    for (const name of Object.keys(sec)) {
      decorators.push(name === 'bearerAuth' ? ApiBearerAuth('bearerAuth') : ApiSecurity(name));
    }
  }
  for (const [name, schema] of Object.entries(s.headers?.properties ?? {})) {
    decorators.push(
      ApiHeader({ name, required: s.headers?.required?.includes(name) ?? false, description: schema.description, schema }),
    );
  }
  for (const [name, schema] of Object.entries(s.querystring?.properties ?? {})) {
    decorators.push(ApiQuery({ name, required: false, schema }));
  }
  if (s.body) decorators.push(ApiBody({ schema: s.body }));
  for (const [status, { description, headers, ...schema }] of Object.entries(s.response)) {
    decorators.push(ApiResponse({ status: Number(status), description, headers, schema }));
  }
  return applyDecorators(...decorators);
}

// ---- Schemas reutilizables ----

const amount = { type: 'string', pattern: '^\\d{1,9}(\\.\\d{1,2})?$', example: '150.25' } as const;
const currency = { type: 'string', enum: ['USD'], example: 'USD' } as const;

export const errorResponse = (description: string, code: string) => ({
  description,
  type: 'object',
  properties: {
    error: {
      type: 'object',
      properties: {
        code: { type: 'string', example: code },
        message: { type: 'string' },
        details: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
      required: ['code', 'message'],
    },
  },
});

const transaction = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    type: { type: 'string', enum: ['deposit', 'withdrawal', 'webhook_deposit'] },
    amount,
    currency,
    balance_after: amount,
    reference: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
} as const;

const bearer = [{ bearerAuth: [] }];
const unauthorized = errorResponse(
  'Token ausente (UNAUTHORIZED), inválido (INVALID_TOKEN) o vencido (TOKEN_EXPIRED)',
  'UNAUTHORIZED',
);

export const healthSchema = {
  tags: ['Sistema'],
  summary: 'Estado del servicio',
  response: {
    200: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } },
  },
};

export const loginSchema = {
  tags: ['Auth'],
  summary: 'Iniciar sesión',
  body: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', example: 'ana@orbita.test' },
      password: { type: 'string', example: 'Ana12345!' },
    },
  },
  response: {
    200: {
      description: 'Token emitido',
      type: 'object',
      properties: {
        access_token: { type: 'string' },
        token_type: { type: 'string', example: 'Bearer' },
        expires_in: { type: 'integer', description: 'Segundos', example: 900 },
      },
    },
    400: errorResponse('Datos inválidos', 'VALIDATION_ERROR'),
    401: errorResponse('Credenciales incorrectas', 'INVALID_CREDENTIALS'),
  },
};

export const getBalanceSchema = {
  tags: ['Balances'],
  summary: 'Saldo actual',
  security: bearer,
  response: {
    200: {
      description: 'Saldo del usuario',
      type: 'object',
      properties: {
        user_id: { type: 'string' },
        amount,
        currency,
        updated_at: { type: 'string', format: 'date-time' },
      },
    },
    401: unauthorized,
  },
};

export const listTransactionsSchema = {
  tags: ['Balances'],
  summary: 'Historial de movimientos (paginado)',
  security: bearer,
  querystring: {
    type: 'object',
    properties: {
      page: { type: 'integer', minimum: 1, default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
    },
  },
  response: {
    200: {
      description: 'Página de movimientos, del más reciente al más antiguo',
      type: 'object',
      properties: {
        data: { type: 'array', items: transaction },
        pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer' },
            limit: { type: 'integer' },
            total: { type: 'integer' },
            total_pages: { type: 'integer' },
          },
        },
      },
    },
    400: errorResponse('Parámetros inválidos', 'VALIDATION_ERROR'),
    401: unauthorized,
  },
};

const moneyOperation = (summary: string, unprocessable: object) => ({
  tags: ['Balances'],
  summary,
  description:
    'Idempotente: repetir la misma `Idempotency-Key` con el mismo monto devuelve la respuesta original (header `Idempotent-Replayed: true`). Monto máximo por operación: 10,000 USD.',
  security: bearer,
  headers: {
    type: 'object',
    required: ['idempotency-key'],
    properties: {
      'idempotency-key': {
        type: 'string',
        maxLength: 255,
        description: 'Llave única por operación (ej. un UUID)',
      },
    },
  },
  body: {
    type: 'object',
    required: ['amount', 'currency'],
    additionalProperties: false,
    properties: { amount, currency },
  },
  response: {
    201: {
      description: 'Operación aplicada (o respuesta repetida si la llave ya existía)',
      headers: {
        'Idempotent-Replayed': {
          description: '"true" cuando se devuelve la respuesta guardada de una llave ya usada',
          schema: { type: 'string', enum: ['true'] },
        },
      },
      type: 'object',
      properties: {
        transaction,
        balance: { type: 'object', properties: { amount, currency } },
      },
    },
    400: errorResponse('Datos inválidos o falta Idempotency-Key', 'IDEMPOTENCY_KEY_REQUIRED'),
    401: unauthorized,
    422: unprocessable,
  },
});

export const depositSchema = moneyOperation(
  'Depositar saldo',
  errorResponse('Idempotency-Key reutilizada con otro monto', 'IDEMPOTENCY_KEY_REUSED'),
);

export const withdrawalSchema = moneyOperation(
  'Retirar saldo',
  errorResponse(
    'Saldo insuficiente (INSUFFICIENT_FUNDS) o Idempotency-Key reutilizada con otro monto (IDEMPOTENCY_KEY_REUSED)',
    'INSUFFICIENT_FUNDS',
  ),
);

export const webhookSchema = {
  tags: ['Webhooks'],
  summary: 'Evento de la pasarela de pagos',
  description:
    'Firma: HMAC-SHA256 en hexadecimal del body exacto con `WEBHOOK_SECRET`, en el header `X-Signature` (no se acepta `XSignature`). Eventos repetidos (`event_id`) se procesan una sola vez: `processed` (acreditado), `duplicate` (ya recibido) o `ignored` (`rejected`, no acredita).',
  security: [{ webhookSignature: [] }],
  body: {
    type: 'object',
    required: ['event_id', 'user_id', 'amount', 'currency', 'status'],
    properties: {
      event_id: { type: 'string', maxLength: 255 },
      user_id: { type: 'string', maxLength: 255 },
      amount,
      currency,
      status: { type: 'string', enum: ['approved', 'rejected'] },
    },
  },
  response: {
    200: {
      description: 'Resultado del procesamiento',
      type: 'object',
      properties: { status: { type: 'string', enum: ['processed', 'ignored', 'duplicate'] } },
    },
    400: errorResponse('Datos inválidos', 'VALIDATION_ERROR'),
    401: errorResponse('Firma inválida', 'INVALID_SIGNATURE'),
    404: errorResponse('El usuario del evento no existe', 'USER_NOT_FOUND'),
  },
};
