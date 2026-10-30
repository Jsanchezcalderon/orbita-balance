import { readFileSync } from 'node:fs';
import type { Pool } from './pool.js';

/** Aplica schema.sql (idempotente: todo usa IF NOT EXISTS). */
export async function migrate(pool: Pool): Promise<void> {
  const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}
