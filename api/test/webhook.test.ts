import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { signBody } from '../src/lib/hmac.js';
import { ANA, bearer, config, createTestApp, loginAs, postWebhook, resetDb } from './helpers.js';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => (ctx = await createTestApp()));
afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.pool));

const event = (over: Record<string, unknown> = {}) => ({
  event_id: 'evt_8f2a',
  user_id: ANA.id,
  amount: '200.00',
  currency: 'USD',
  status: 'approved',
  ...over,
});

const balanceOf = async () => {
  const token = await loginAs(ctx.app);
  return (await ctx.app.inject({ method: 'GET', url: '/balances/me', headers: bearer(token) })).json().amount;
};

describe('POST /webhooks/payment-gateway', () => {
  it('rechaza firma inválida con 401 y no acredita', async () => {
    const res = await postWebhook(ctx.app, event(), 'a'.repeat(64));
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_SIGNATURE');
    expect(await balanceOf()).toBe('0.00');
  });

  it('rechaza una solicitud sin firma', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/payment-gateway',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(event()),
    });
    expect(res.statusCode).toBe(401);
  });

  it('la firma se valida sobre el body crudo (no sobre JSON re-serializado)', async () => {
    // Mismo contenido con otros espacios, pero firma del body original -> inválida.
    const tampered = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/payment-gateway',
      headers: {
        'content-type': 'application/json',
        'x-signature': signBody(JSON.stringify(event({ event_id: 'evt_2' })), config.WEBHOOK_SECRET),
      },
      payload: JSON.stringify(event({ event_id: 'evt_2' }), null, 2),
    });
    expect(tampered.statusCode).toBe(401);
  });

  it('acredita un evento aprobado y registra el movimiento', async () => {
    const res = await postWebhook(ctx.app, event());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'processed' });
    expect(await balanceOf()).toBe('200.00');
    const { rows } = await ctx.pool.query('SELECT type, reference FROM transactions');
    expect(rows).toEqual([{ type: 'webhook_deposit', reference: 'evt_8f2a' }]);
  });

  it('un evento repetido no acredita dos veces', async () => {
    await postWebhook(ctx.app, event());
    const again = await postWebhook(ctx.app, event());
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ status: 'duplicate' });
    expect(await balanceOf()).toBe('200.00');
  });

  it('eventos duplicados concurrentes acreditan una sola vez', async () => {
    await Promise.all(Array.from({ length: 5 }, () => postWebhook(ctx.app, event())));
    expect(await balanceOf()).toBe('200.00');
  });

  it('un evento rechazado no acredita', async () => {
    const res = await postWebhook(ctx.app, event({ status: 'rejected' }));
    expect(res.statusCode).toBe(200);
    expect(await balanceOf()).toBe('0.00');
  });

  it('usuario inexistente -> 404 y el evento queda sin registrar (se puede reintentar)', async () => {
    const res = await postWebhook(ctx.app, event({ user_id: 'u_999' }));
    expect(res.statusCode).toBe(404);
    const { rowCount } = await ctx.pool.query('SELECT 1 FROM webhook_events');
    expect(rowCount).toBe(0);
  });

  it('valida el contenido del evento (firma correcta, datos inválidos)', async () => {
    const res = await postWebhook(ctx.app, event({ amount: '-1' }));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rechaza el header sin guion (XSignature): solo se acepta X-Signature', async () => {
    const raw = JSON.stringify(event());
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/webhooks/payment-gateway',
      headers: { 'content-type': 'application/json', xsignature: signBody(raw, config.WEBHOOK_SECRET) },
      payload: raw,
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_SIGNATURE');
  });
});
