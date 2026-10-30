import { createHmac, timingSafeEqual } from 'node:crypto';

export function signBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Compara la firma HMAC-SHA256 (hex) en tiempo constante. */
export function verifySignature(rawBody: string, secret: string, signature: string): boolean {
  const expected = Buffer.from(signBody(rawBody, secret), 'hex');
  const received = Buffer.from(signature.trim(), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}
