import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://orbita:orbita@localhost:5432/orbita_test';
