import bcrypt from 'bcryptjs';
import { SignJWT } from 'jose';
import pg from 'pg';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { signBody } from '../src/lib/hmac.js';
import { TEST_DATABASE_URL } from './env.js';

export const config: Config = {
  PORT: 0,
  DATABASE_URL: TEST_DATABASE_URL,
  JWT_SECRET: 'test-jwt-secret-0123456789',
  JWT_EXPIRES_IN: '15m',
  WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
  CORS_ORIGIN: 'http://localhost:5173',
  SEED_ON_START: false,
};

export const ANA = { id: 'u_123', email: 'ana@orbita.test', password: 'Ana12345!' };
export const BETO = { id: 'u_456', email: 'beto@orbita.test', password: 'Beto12345!' };

const hashes = new Map<string, string>();
function fastHash(password: string) {
  if (!hashes.has(password)) hashes.set(password, bcrypt.hashSync(password, 4)); // cost bajo: tests rápidos
  return hashes.get(password)!;
}

interface InjectOptions {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  headers?: Record<string, string>;
  /** Objeto (se envía como JSON) o string crudo (se envía tal cual). */
  payload?: unknown;
}

export interface TestApp {
  inject(opts: InjectOptions): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    body: string;
    json: () => any;
  }>;
}

export async function createTestApp() {
  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  const nest = await buildApp({ config, pool, logger: false });
  await nest.init();
  const server = nest.getHttpServer();

  const app: TestApp = {
    async inject({ method, url, headers = {}, payload }) {
      let req = request(server)[method.toLowerCase() as 'get' | 'post'](url).set(headers);
      if (payload !== undefined) {
        const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
        if (!Object.keys(headers).some((h) => h.toLowerCase() === 'content-type')) {
          req = req.set('content-type', 'application/json');
        }
        req = req.send(raw);
      }
      const res = await req;
      return { statusCode: res.status, headers: res.headers, body: res.text, json: () => JSON.parse(res.text) };
    },
  };

  return {
    app,
    pool,
    close: async () => {
      await nest.close();
      await pool.end();
    },
  };
}

export async function resetDb(pool: pg.Pool) {
  await pool.query(
    'TRUNCATE users, balances, transactions, idempotency_keys, webhook_events RESTART IDENTITY CASCADE',
  );
  for (const u of [ANA, BETO]) {
    await pool.query('INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3)', [
      u.id,
      u.email,
      fastHash(u.password),
    ]);
  }
}

export async function loginAs(app: TestApp, user = ANA): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { email: user.email, password: user.password },
  });
  return res.json().access_token;
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

let counter = 0;
export const newKey = () => `test-key-${Date.now()}-${++counter}`;

export function money(app: TestApp, token: string, kind: 'deposits' | 'withdrawals', amount: string, key = newKey()) {
  return app.inject({
    method: 'POST',
    url: `/balances/me/${kind}`,
    headers: { ...bearer(token), 'idempotency-key': key },
    payload: { amount, currency: 'USD' },
  });
}

export function postWebhook(app: TestApp, event: Record<string, unknown>, signature?: string) {
  const raw = JSON.stringify(event);
  return app.inject({
    method: 'POST',
    url: '/webhooks/payment-gateway',
    headers: { 'content-type': 'application/json', 'x-signature': signature ?? signBody(raw, config.WEBHOOK_SECRET) },
    payload: raw,
  });
}

export async function expiredToken(userId = ANA.id) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer('orbita-api')
    .setIssuedAt(now - 3600)
    .setExpirationTime(now - 1800)
    .sign(new TextEncoder().encode(config.JWT_SECRET));
}
