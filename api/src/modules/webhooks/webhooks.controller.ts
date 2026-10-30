import { Body, Controller, HttpCode, Inject, Post, type RawBodyRequest, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { CONFIG, POOL } from '../../common/tokens.js';
import type { Config } from '../../config.js';
import type { Pool } from '../../db/pool.js';
import { withTransaction } from '../../db/pool.js';
import { ApiDocs, webhookSchema as webhookDocs } from '../../docs/openapi.js';
import { AppError } from '../../lib/errors.js';
import { verifySignature } from '../../lib/hmac.js';
import { amountSchema, currencySchema } from '../../lib/money.js';
import { creditBalance } from '../balances/service.js';

const webhookSchema = z.object({
  event_id: z.string().min(1, 'event_id es obligatorio').max(255),
  user_id: z.string().min(1, 'user_id es obligatorio').max(255),
  amount: amountSchema,
  currency: currencySchema,
  status: z.enum(['approved', 'rejected'], {
    errorMap: () => ({ message: 'status debe ser "approved" o "rejected"' }),
  }),
});

@Controller('webhooks')
export class WebhooksController {
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Post('payment-gateway')
  @HttpCode(200)
  @ApiDocs(webhookDocs)
  async paymentGateway(@Req() req: RawBodyRequest<Request>, @Body() body: unknown) {
    // Solo se acepta "X-Signature" (no la variante sin guion "XSignature").
    const header = req.headers['x-signature'];
    const signature = Array.isArray(header) ? header[0] : header;

    // La firma se valida sobre el body CRUDO, antes de interpretar su contenido.
    const rawBody = req.rawBody?.toString('utf8') ?? '';
    if (!signature || !verifySignature(rawBody, this.config.WEBHOOK_SECRET, signature)) {
      throw new AppError(401, 'INVALID_SIGNATURE', 'Firma del webhook inválida.');
    }

    const event = webhookSchema.parse(body);

    const status = await withTransaction(this.pool, async (client) => {
      // La PK de webhook_events hace que un evento repetido (o concurrente) se procese una vez.
      const recorded = await client.query(
        `INSERT INTO webhook_events (event_id, user_id, status, amount_cents)
         VALUES ($1, $2, $3, $4) ON CONFLICT (event_id) DO NOTHING`,
        [event.event_id, event.user_id, event.status, event.amount],
      );
      if ((recorded.rowCount ?? 0) === 0) return 'duplicate' as const;
      if (event.status === 'rejected') return 'ignored' as const;

      const user = await client.query('SELECT 1 FROM users WHERE id = $1', [event.user_id]);
      if (!user.rowCount) {
        // El ROLLBACK también deshace el registro del evento: la pasarela puede reintentar.
        throw new AppError(404, 'USER_NOT_FOUND', 'El usuario del evento no existe.');
      }

      await creditBalance(client, event.user_id, event.amount, 'webhook_deposit', event.event_id);
      return 'processed' as const;
    });

    return { status };
  }
}
