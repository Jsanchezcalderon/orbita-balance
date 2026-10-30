import { createHash } from 'node:crypto';
import type { Client, Pool } from '../../db/pool.js';
import { withTransaction } from '../../db/pool.js';
import { AppError } from '../../lib/errors.js';
import { centsToAmount } from '../../lib/money.js';

export type OperationKind = 'deposit' | 'withdrawal';

interface TxRow {
  id: string;
  type: string;
  amount_cents: string;
  balance_after: string;
  reference: string | null;
  created_at: Date;
}

const TX_COLUMNS = 'id, type, amount_cents, balance_after, reference, created_at';

export function serializeTransaction(r: TxRow) {
  return {
    id: r.id,
    type: r.type,
    amount: centsToAmount(r.amount_cents),
    currency: 'USD',
    balance_after: centsToAmount(r.balance_after),
    reference: r.reference,
    created_at: r.created_at.toISOString(),
  };
}

export async function ensureBalance(db: Pool | Client, userId: string): Promise<void> {
  await db.query('INSERT INTO balances (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [userId]);
}

/** Suma `cents` al saldo y registra el movimiento. Debe ejecutarse dentro de una transacción. */
export async function creditBalance(
  client: Client,
  userId: string,
  cents: number,
  type: 'deposit' | 'webhook_deposit',
  reference: string | null,
) {
  await ensureBalance(client, userId);
  const upd = await client.query<{ amount_cents: string }>(
    `UPDATE balances SET amount_cents = amount_cents + $2, updated_at = now()
     WHERE user_id = $1 RETURNING amount_cents`,
    [userId, cents],
  );
  return recordTransaction(client, userId, type, cents, upd.rows[0]!.amount_cents, reference);
}

async function recordTransaction(
  client: Client,
  userId: string,
  type: string,
  cents: number,
  balanceAfter: string,
  reference: string | null,
) {
  const ins = await client.query<TxRow>(
    `INSERT INTO transactions (user_id, type, amount_cents, balance_after, reference)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${TX_COLUMNS}`,
    [userId, type, cents, balanceAfter, reference],
  );
  return { tx: ins.rows[0]!, balanceAfter };
}

export async function getBalance(pool: Pool, userId: string) {
  await ensureBalance(pool, userId);
  const { rows } = await pool.query<{ amount_cents: string; updated_at: Date }>(
    'SELECT amount_cents, updated_at FROM balances WHERE user_id = $1',
    [userId],
  );
  const row = rows[0]!;
  return {
    user_id: userId,
    amount: centsToAmount(row.amount_cents),
    currency: 'USD',
    updated_at: row.updated_at.toISOString(),
  };
}

export async function listTransactions(pool: Pool, userId: string, page: number, limit: number) {
  const [count, list] = await Promise.all([
    pool.query<{ total: string }>('SELECT count(*) AS total FROM transactions WHERE user_id = $1', [
      userId,
    ]),
    pool.query<TxRow>(
      `SELECT ${TX_COLUMNS} FROM transactions WHERE user_id = $1
       ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, limit, (page - 1) * limit],
    ),
  ]);
  const total = Number(count.rows[0]!.total);
  return {
    data: list.rows.map(serializeTransaction),
    pagination: { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) },
  };
}

export interface OperationResult {
  status: number;
  body: unknown;
  replayed: boolean;
}

/**
 * Depósito o retiro idempotente. Todo ocurre en una transacción:
 *  1. Reserva la llave (INSERT ... ON CONFLICT DO NOTHING). Una solicitud concurrente con la
 *     misma llave espera aquí hasta que la primera haga COMMIT/ROLLBACK.
 *  2. Si la llave ya existía: mismo hash -> devuelve la respuesta guardada; otro hash -> 422.
 *  3. UPDATE atómico del saldo (el retiro exige `amount_cents >= monto`).
 *  4. Guarda la respuesta junto con la llave.
 * Los errores de negocio (saldo insuficiente) hacen ROLLBACK y no consumen la llave.
 */
export async function applyOperation(
  pool: Pool,
  input: { userId: string; kind: OperationKind; cents: number; idempotencyKey: string },
): Promise<OperationResult> {
  const { userId, kind, cents, idempotencyKey } = input;
  const requestHash = createHash('sha256').update(`${kind}:${cents}:USD`).digest('hex');

  return withTransaction(pool, async (client) => {
    const reserved = await client.query(
      `INSERT INTO idempotency_keys (user_id, key, endpoint, request_hash)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [userId, idempotencyKey, kind, requestHash],
    );

    if ((reserved.rowCount ?? 0) === 0) {
      const { rows } = await client.query<{
        request_hash: string;
        status_code: number;
        response: unknown;
      }>(
        `SELECT request_hash, status_code, response FROM idempotency_keys
         WHERE user_id = $1 AND key = $2 AND endpoint = $3`,
        [userId, idempotencyKey, kind],
      );
      const previous = rows[0]!;
      if (previous.request_hash !== requestHash) {
        throw new AppError(
          422,
          'IDEMPOTENCY_KEY_REUSED',
          'Esa Idempotency-Key ya se usó con un monto distinto. Usa una llave nueva.',
        );
      }
      return { status: previous.status_code, body: previous.response, replayed: true };
    }

    await ensureBalance(client, userId);

    let result;
    if (kind === 'deposit') {
      result = await creditBalance(client, userId, cents, 'deposit', null);
    } else {
      const upd = await client.query<{ amount_cents: string }>(
        `UPDATE balances SET amount_cents = amount_cents - $2, updated_at = now()
         WHERE user_id = $1 AND amount_cents >= $2 RETURNING amount_cents`,
        [userId, cents],
      );
      if ((upd.rowCount ?? 0) === 0) {
        throw new AppError(422, 'INSUFFICIENT_FUNDS', 'Saldo insuficiente para realizar el retiro.');
      }
      result = await recordTransaction(client, userId, 'withdrawal', cents, upd.rows[0]!.amount_cents, null);
    }

    const body = {
      transaction: serializeTransaction(result.tx),
      balance: { amount: centsToAmount(result.balanceAfter), currency: 'USD' },
    };
    await client.query(
      `UPDATE idempotency_keys SET status_code = $4, response = $5
       WHERE user_id = $1 AND key = $2 AND endpoint = $3`,
      [userId, idempotencyKey, kind, 201, JSON.stringify(body)],
    );
    return { status: 201, body, replayed: false };
  });
}
