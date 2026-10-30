import pg from 'pg';
import { migrate } from '../src/db/migrate.js';
import { TEST_DATABASE_URL } from './env.js';

/** Crea la BD de pruebas si no existe y aplica el esquema. */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);

  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL.replace(`/${dbName}`, '/postgres') });
  try {
    await admin.connect();
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (!exists.rowCount) await admin.query(`CREATE DATABASE "${dbName}"`);
  } catch (err) {
    throw new Error(
      `No se pudo preparar la BD de pruebas (${dbName}). ¿PostgreSQL está corriendo y TEST_DATABASE_URL es correcta?\n${err}`,
    );
  } finally {
    await admin.end().catch(() => undefined);
  }

  const pool = new pg.Pool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await pool.end();
}
