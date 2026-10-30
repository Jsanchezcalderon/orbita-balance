import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'es obligatoria'),
  JWT_SECRET: z.string().min(16, 'debe tener al menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  WEBHOOK_SECRET: z.string().min(16, 'debe tener al menos 16 caracteres'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  SEED_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Configuración inválida (revisa tu .env):\n${lines.join('\n')}`);
  }
  return result.data;
}

/** Carga el .env de la raíz del repo (no pisa variables ya definidas). */
export function loadEnvFile(): void {
  dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });
}
