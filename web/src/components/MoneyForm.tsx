import { useRef, useState, type FormEvent } from 'react';
import { api, ApiError } from '../api/client';
import { formatUsd, newIdempotencyKey, normalizeAmount, validateAmount } from '../lib/money';

type Mode = 'deposit' | 'withdrawal';

const LABELS: Record<Mode, { action: string; done: string }> = {
  deposit: { action: 'Depositar', done: 'Depósito acreditado' },
  withdrawal: { action: 'Retirar', done: 'Retiro realizado' },
};

export function MoneyForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('deposit');
  const [amount, setAmount] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // La llave se conserva si la operación falla (p. ej. se cortó la red) para que el reintento
  // no duplique el movimiento. Cambia solo si cambia la operación o el monto.
  const keyRef = useRef<{ signature: string; key: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSuccess(null);
    setError(null);

    const validation = validateAmount(amount);
    setFieldError(validation);
    if (validation) return;

    const normalized = normalizeAmount(amount);
    const signature = `${mode}:${normalized}`;
    if (keyRef.current?.signature !== signature) {
      keyRef.current = { signature, key: newIdempotencyKey() };
    }

    setSubmitting(true);
    try {
      const call = mode === 'deposit' ? api.deposit : api.withdraw;
      await call(normalized, keyRef.current.key);
      keyRef.current = null;
      setAmount('');
      setSuccess(`${LABELS[mode].done}: ${formatUsd(normalized)}.`);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return; // la sesión vuelve al login
      setError(err instanceof ApiError ? err.message : 'No pudimos completar la operación.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="card stack" onSubmit={onSubmit} noValidate aria-labelledby="op-title">
      <h2 id="op-title">Mover saldo</h2>

      <fieldset className="segmented" disabled={submitting}>
        <legend className="sr-only">Operación</legend>
        {(['deposit', 'withdrawal'] as const).map((m) => (
          <label key={m} className={mode === m ? 'is-active' : undefined}>
            <input
              type="radio"
              name="operation"
              value={m}
              checked={mode === m}
              onChange={() => {
                setMode(m);
                // Si había un error (de validación o del servidor), se limpia el monto y los errores.
                if (fieldError || error) setAmount('');
                setFieldError(null);
                setError(null);
                setSuccess(null);
              }}
            />
            {LABELS[m].action}
          </label>
        ))}
      </fieldset>

      <div className="field">
        <label htmlFor="amount">Monto (USD)</label>
        <input
          id="amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setFieldError(null);
          }}
          aria-invalid={!!fieldError}
          aria-describedby={fieldError ? 'amount-error' : 'amount-hint'}
        />
        {fieldError ? (
          <p id="amount-error" className="field-error">
            {fieldError}
          </p>
        ) : (
          <p id="amount-hint" className="hint">
            Máximo 10,000 USD por operación, con hasta 2 decimales.
          </p>
        )}
      </div>

      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="alert alert-ok" role="status">
          {success}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={submitting}>
        {submitting ? 'Procesando…' : LABELS[mode].action}
      </button>
    </form>
  );
}
