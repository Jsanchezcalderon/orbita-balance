import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers.js';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => (ctx = await createTestApp()));
afterAll(() => ctx.close());

describe('documentación OpenAPI', () => {
  it('publica todos los endpoints en /docs/json', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining([
        '/health',
        '/auth/login',
        '/balances/me',
        '/balances/me/transactions',
        '/balances/me/deposits',
        '/balances/me/withdrawals',
        '/webhooks/payment-gateway',
      ]),
    );
    expect(spec.components.securitySchemes.bearerAuth).toBeDefined();
  });

  it('sirve la interfaz Swagger UI', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
  });

  it('no altera el formato de error de validación', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});
