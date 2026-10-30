import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ANA, BETO, bearer, createTestApp, loginAs, money, newKey, resetDb } from './helpers.js';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let token: string;
beforeAll(async () => (ctx = await createTestApp()));
afterAll(() => ctx.close());
beforeEach(async () => {
  await resetDb(ctx.pool);
  token = await loginAs(ctx.app);
});

const getBalance = async (t = token) =>
  (await ctx.app.inject({ method: 'GET', url: '/balances/me', headers: bearer(t) })).json();

describe('GET /balances/me', () => {
  it('crea el saldo en 0 si no existe', async () => {
    const body = await getBalance();
    expect(body).toMatchObject({ user_id: ANA.id, amount: '0.00', currency: 'USD' });
    const { rows } = await ctx.pool.query('SELECT 1 FROM balances WHERE user_id = $1', [ANA.id]);
    expect(rows).toHaveLength(1);
  });
});

describe('depósitos', () => {
  it('acredita el monto y registra el movimiento', async () => {
    const res = await money(ctx.app, token, 'deposits', '150.25');
    expect(res.statusCode).toBe(201);
    expect(res.json().balance.amount).toBe('150.25');
    expect((await getBalance()).amount).toBe('150.25');
  });

  it('es idempotente: la misma llave devuelve lo mismo y no repite el depósito', async () => {
    const key = newKey();
    const first = await money(ctx.app, token, 'deposits', '100.00', key);
    const second = await money(ctx.app, token, 'deposits', '100.00', key);
    expect(second.statusCode).toBe(first.statusCode);
    expect(second.json()).toEqual(first.json());
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect((await getBalance()).amount).toBe('100.00');
  });

  it('la misma llave con otro monto responde 422', async () => {
    const key = newKey();
    await money(ctx.app, token, 'deposits', '100.00', key);
    const res = await money(ctx.app, token, 'deposits', '200.00', key);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('solicitudes concurrentes con la misma llave acreditan una sola vez', async () => {
    const key = newKey();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => money(ctx.app, token, 'deposits', '40.00', key)),
    );
    expect(results.every((r) => r.statusCode === 201)).toBe(true);
    expect((await getBalance()).amount).toBe('40.00');
  });

  it('exige el header Idempotency-Key', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/balances/me/deposits',
      headers: bearer(token),
      payload: { amount: '10.00', currency: 'USD' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it.each([
    ['cero', { amount: '0', currency: 'USD' }],
    ['negativo', { amount: '-5.00', currency: 'USD' }],
    ['3 decimales', { amount: '10.123', currency: 'USD' }],
    ['no numérico', { amount: 'abc', currency: 'USD' }],
    ['sobre el máximo', { amount: '10000.01', currency: 'USD' }],
    ['otra moneda', { amount: '10.00', currency: 'EUR' }],
    ['monto como número', { amount: 10, currency: 'USD' }],
    ['user_id en el body', { amount: '10.00', currency: 'USD', user_id: BETO.id }],
  ])('rechaza %s con 400', async (_name, payload) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/balances/me/deposits',
      headers: { ...bearer(token), 'idempotency-key': newKey() },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('acepta el máximo exacto de 10,000.00', async () => {
    const res = await money(ctx.app, token, 'deposits', '10000.00');
    expect(res.statusCode).toBe(201);
  });

  it('el usuario sale del token: un header X-User-Id se ignora', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/balances/me/deposits',
      headers: { ...bearer(token), 'idempotency-key': newKey(), 'x-user-id': BETO.id },
      payload: { amount: '10.00', currency: 'USD' },
    });
    expect(res.statusCode).toBe(201);
    const { rows } = await ctx.pool.query('SELECT user_id FROM transactions');
    expect(rows).toEqual([{ user_id: ANA.id }]);
  });
});

describe('retiros', () => {
  it('descuenta del saldo', async () => {
    await money(ctx.app, token, 'deposits', '100.00');
    const res = await money(ctx.app, token, 'withdrawals', '30.50');
    expect(res.statusCode).toBe(201);
    expect((await getBalance()).amount).toBe('69.50');
  });

  it('rechaza retiros mayores al saldo y el saldo no cambia', async () => {
    await money(ctx.app, token, 'deposits', '20.00');
    const res = await money(ctx.app, token, 'withdrawals', '20.01');
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('INSUFFICIENT_FUNDS');
    expect((await getBalance()).amount).toBe('20.00');
  });

  it('retiros concurrentes nunca dejan el saldo negativo', async () => {
    await money(ctx.app, token, 'deposits', '100.00');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => money(ctx.app, token, 'withdrawals', '30.00')),
    );
    const ok = results.filter((r) => r.statusCode === 201).length;
    const rejected = results.filter((r) => r.statusCode === 422).length;
    expect(ok).toBe(3);
    expect(rejected).toBe(3);
    expect((await getBalance()).amount).toBe('10.00');
  });

  it('es idempotente', async () => {
    await money(ctx.app, token, 'deposits', '100.00');
    const key = newKey();
    await money(ctx.app, token, 'withdrawals', '40.00', key);
    const replay = await money(ctx.app, token, 'withdrawals', '40.00', key);
    expect(replay.statusCode).toBe(201);
    expect((await getBalance()).amount).toBe('60.00');
  });
});

describe('GET /balances/me/transactions', () => {
  it('lista del más reciente al más antiguo con paginación', async () => {
    for (const amount of ['1.00', '2.00', '3.00', '4.00', '5.00']) {
      await money(ctx.app, token, 'deposits', amount);
    }
    const p1 = await ctx.app.inject({
      method: 'GET',
      url: '/balances/me/transactions?page=1&limit=2',
      headers: bearer(token),
    });
    const p3 = await ctx.app.inject({
      method: 'GET',
      url: '/balances/me/transactions?page=3&limit=2',
      headers: bearer(token),
    });
    expect(p1.json().data.map((t: { amount: string }) => t.amount)).toEqual(['5.00', '4.00']);
    expect(p1.json().pagination).toEqual({ page: 1, limit: 2, total: 5, total_pages: 3 });
    expect(p3.json().data.map((t: { amount: string }) => t.amount)).toEqual(['1.00']);
  });

  it('solo muestra los movimientos del usuario autenticado', async () => {
    await money(ctx.app, token, 'deposits', '10.00');
    const betoToken = await loginAs(ctx.app, BETO);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/balances/me/transactions',
      headers: bearer(betoToken),
    });
    expect(res.json().data).toEqual([]);
    expect(res.json().pagination.total).toBe(0);
  });

  it('rechaza parámetros de paginación inválidos', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/balances/me/transactions?limit=1000',
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(400);
  });
});
