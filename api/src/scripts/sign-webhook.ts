// Uso: npm -w api run sign-webhook -- '{"event_id":"evt_1",...}'
// Imprime la firma HMAC-SHA256 (hex) para el header X-Signature.
import { loadConfig, loadEnvFile } from '../config.js';
import { signBody } from '../lib/hmac.js';

loadEnvFile();
const body = process.argv[2];
if (!body) {
  console.error("Uso: npm -w api run sign-webhook -- '<body JSON exacto>'");
  process.exit(1);
}
console.log(signBody(body, loadConfig().WEBHOOK_SECRET));
