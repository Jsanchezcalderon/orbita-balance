import bcrypt from 'bcryptjs';
import type { Pool } from './pool.js';

export const SEED_USERS = [
  { id: 'u_123', email: 'ana@orbita.test', password: 'Ana12345!' },
  { id: 'u_456', email: 'beto@orbita.test', password: 'Beto12345!' },
] as const;

/** Crea los usuarios de prueba si no existen. Las contraseñas se guardan con bcrypt. */
export async function seedUsers(pool: Pool, rounds = 10): Promise<void> {
  for (const u of SEED_USERS) {
    const exists = await pool.query('SELECT 1 FROM users WHERE id = $1', [u.id]);
    if (exists.rowCount) continue;
    const hash = await bcrypt.hash(u.password, rounds);
    await pool.query(
      'INSERT INTO users (id, email, password_hash) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
      [u.id, u.email, hash],
    );
  }
}
