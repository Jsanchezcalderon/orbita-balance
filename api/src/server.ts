import { buildApp } from './app.js';
import { loadConfig, loadEnvFile } from './config.js';
import { createPool } from './db/pool.js';
import { migrate } from './db/migrate.js';
import { seedUsers } from './db/seed.js';

loadEnvFile();
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);

await migrate(pool);
if (config.SEED_ON_START) await seedUsers(pool);

const app = await buildApp({ config, pool });

const shutdown = async () => {
  await app.close();
  await pool.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen(config.PORT, '0.0.0.0');
