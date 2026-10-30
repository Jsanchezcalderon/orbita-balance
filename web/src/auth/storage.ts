const KEY = 'orbita.token';

// localStorage puede fallar (modo privado, cuota): nunca debe romper la app.
export function getToken(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(KEY, token);
  } catch {
    /* la sesión durará solo mientras la pestaña esté abierta */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
