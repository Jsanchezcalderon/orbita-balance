export const MAX_AMOUNT = 10_000;

/** Acepta coma decimal ("150,25") y la normaliza a punto. */
export function normalizeAmount(input: string): string {
  const v = input.trim();
  return !v.includes('.') && (v.match(/,/g) ?? []).length === 1 ? v.replace(',', '.') : v;
}

/** Devuelve un mensaje de error o null si el monto es válido (mismas reglas que la API). */
export function validateAmount(input: string): string | null {
  const v = normalizeAmount(input);
  if (!v) return 'Ingresa un monto.';
  if (!/^\d+(\.\d+)?$/.test(v)) return 'Usa solo números positivos, por ejemplo 150.25.';
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return 'El monto admite máximo 2 decimales.';
  const n = Number(v);
  if (n <= 0) return 'El monto debe ser mayor que 0.';
  if (n > MAX_AMOUNT) return 'El monto máximo por operación es 10,000 USD.';
  return null;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
export const formatUsd = (amount: string): string => usd.format(Number(amount));

const dateTime = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
export const formatDateTime = (iso: string): string => dateTime.format(new Date(iso));

export function newIdempotencyKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
