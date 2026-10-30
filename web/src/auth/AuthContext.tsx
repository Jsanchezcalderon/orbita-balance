import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler } from '../api/client';
import { clearToken, getToken, saveToken } from './storage';

export const SESSION_EXPIRED_MESSAGE = 'Tu sesión expiró o ya no es válida. Inicia sesión de nuevo para continuar.';

interface AuthValue {
  isAuthenticated: boolean;
  /** Mensaje para mostrar en el login (p. ej. sesión vencida). */
  notice: string | null;
  clearNotice: () => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // Lee la sesión guardada: sobrevive a recargas de la página.
  const [token, setToken] = useState<string | null>(() => getToken());
  const [notice, setNotice] = useState<string | null>(null);

  // Layout effect: queda registrado antes de que los hijos hagan su primera petición.
  useLayoutEffect(() => {
    setUnauthorizedHandler(() => {
      clearToken();
      setToken(null);
      setNotice(SESSION_EXPIRED_MESSAGE);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { access_token } = await api.login(email, password);
    saveToken(access_token);
    setNotice(null);
    setToken(access_token);
  }, []);

  const logout = useCallback(() => {
    clearToken();
    setNotice(null);
    setToken(null);
  }, []);

  const clearNotice = useCallback(() => setNotice(null), []);

  const value = useMemo(
    () => ({ isAuthenticated: token !== null, notice, clearNotice, login, logout }),
    [token, notice, clearNotice, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>');
  return ctx;
}
