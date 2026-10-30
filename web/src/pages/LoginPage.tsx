import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function LoginPage() {
  const { login, notice, clearNotice } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Al enfocar un campo se quitan las alertas (general, de campo y de sesión vencida).
  function dismissAlerts() {
    setError(null);
    setFieldErrors({});
    clearNotice();
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const errors: typeof fieldErrors = {};
    if (!EMAIL_RE.test(email.trim())) errors.email = 'Ingresa un correo válido.';
    if (!password) errors.password = 'Ingresa tu contraseña.';
    setFieldErrors(errors);
    setError(null);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'No pudimos iniciar sesión. Inténtalo de nuevo.');
      setSubmitting(false);
    }
  }

  return (
    <main className="auth">
      <h1 className="brand">Orbita</h1>
      <form className="card stack" onSubmit={onSubmit} noValidate aria-labelledby="login-title">
        <h2 id="login-title">Inicia sesión</h2>

        {notice && (
          <p className="alert alert-warn" role="alert">
            {notice}
          </p>
        )}
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}

        <div className="field">
          <label htmlFor="email">Correo</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="correo@ejemplo.com"
            value={email}
            onFocus={dismissAlerts}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!fieldErrors.email}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          />
          {fieldErrors.email && (
            <p id="email-error" className="field-error">
              {fieldErrors.email}
            </p>
          )}
        </div>

        <div className="field">
          <label htmlFor="password">Contraseña</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Tu contraseña"
            value={password}
            onFocus={dismissAlerts}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!fieldErrors.password}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
          />
          {fieldErrors.password && (
            <p id="password-error" className="field-error">
              {fieldErrors.password}
            </p>
          )}
        </div>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          {submitting ? 'Entrando…' : 'Iniciar sesión'}
        </button>
      </form>
    </main>
  );
}
