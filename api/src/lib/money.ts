import { z } from 'zod';

export const MAX_AMOUNT_CENTS = 10_000 * 100; // 10,000 USD por operación

/** "150.25" -> 15025. Devuelve null si no es un decimal positivo con máx. 2 decimales. */
export function parseAmountToCents(input: string): number | null {
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(input);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

/** 15025 -> "150.25" */
export function centsToAmount(cents: number | string | bigint): string {
  const n = BigInt(cents);
  return `${n / 100n}.${(n % 100n).toString().padStart(2, '0')}`;
}

export const amountSchema = z
  .string({
    required_error: 'El monto es obligatorio',
    invalid_type_error: 'El monto debe enviarse como texto, por ejemplo "150.25"',
  })
  .transform((value, ctx) => {
    const cents = parseAmountToCents(value);
    if (cents === null) {
      ctx.addIssue({
        code: 'custom',
        message: 'Monto inválido: usa un número positivo con máximo 2 decimales',
      });
      return z.NEVER;
    }
    if (cents <= 0) {
      ctx.addIssue({ code: 'custom', message: 'El monto debe ser mayor que 0' });
      return z.NEVER;
    }
    if (cents > MAX_AMOUNT_CENTS) {
      ctx.addIssue({ code: 'custom', message: 'El monto máximo por operación es 10,000 USD' });
      return z.NEVER;
    }
    return cents;
  });

export const currencySchema = z.literal('USD', {
  errorMap: () => ({ message: 'Solo se admite la moneda USD' }),
});

export const moneyBodySchema = z
  .object({ amount: amountSchema, currency: currencySchema })
  .strict();
