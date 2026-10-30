import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ANA, bearer, createTestApp, expiredToken, loginAs, resetDb } from './helpers.js';

let ctx: Awaited<ReturnType<typeof createTestApp>>;
beforeAll(async () => (ctx = await createTestApp()));
afterAll(() => ctx.close());
beforeEach(() => resetDb(ctx.pool));

describe('POST /auth/login', () => {
  it('devuelve un token con credenciales válidas', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: ANA.email, password: ANA.password },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ token_type: 'Bearer', expires_in: 900 });
    expect(res.json().access_token).toEqual(expect.any(String));
  });

  it('responde exactamente el mismo error si el email no existe o la contraseña es incorrecta', async () => {
    const wrongPassword = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: ANA.email, password: 'incorrecta' },
    });
    const unknownEmail = await ctx.app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nadie@orbita.test', password: 'incorrecta' },
    });
    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(unknownEmail.json()).toEqual(wrongPassword.json());
    expect(wrongPassword.json().error.code).toBe('INVALID_CREDENTIALS');
  });

  it('guarda las contraseñas con hash', async () => {
    const { rows } = await ctx.pool.query('SELECT password_hash FROM users WHERE id = $1', [ANA.id]);
    expect(rows[0].password_hash).not.toContain(ANA.password);
    expect(rows[0].password_hash).toMatch(/^\$2[aby]\$/);
  });

  it('valida el body con el formato de error común', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/auth/login', payload: {} });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('autenticación de rutas protegidas', () => {
  const routes = [
    { method: 'GET', url: '/balances/me' },
    { method: 'GET', url: '/balances/me/transactions' },
    { method: 'POST', url: '/balances/me/deposits' },
    { method: 'POST', url: '/balances/me/withdrawals' },
  ] as const;

  it.each(routes)('$method $url sin token -> 401', async ({ method, url }) => {
    const res = await ctx.app.inject({ method, url });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('token inválido -> 401', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/balances/me', headers: bearer('no.es.un.jwt') });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('INVALID_TOKEN');
  });

  it('token vencido -> 401', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/balances/me',
      headers: bearer(await expiredToken()),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('TOKEN_EXPIRED');
  });

  it('un token válido da acceso', async () => {
    const token = await loginAs(ctx.app);
    const res = await ctx.app.inject({ method: 'GET', url: '/balances/me', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
  });
});
