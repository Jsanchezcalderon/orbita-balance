import { loadConfig, loadEnvFile } from '../config.js';
import { createPool } from './pool.js';
import { migrate } from './migrate.js';
import { seedUsers } from './seed.js';

loadEnvFile();
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
try {
  await migrate(pool);
  await seedUsers(pool);
  console.log('Esquema aplicado y usuarios de prueba listos.');
} finally {
  await pool.end();
}
