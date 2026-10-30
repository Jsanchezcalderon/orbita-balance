import { getToken } from '../auth/storage';

const BASE_URL = (import.meta.env.VITE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export interface FieldIssue {
  field?: string;
  message: string;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: FieldIssue[],
  ) {
    super(message);
  }
}

let onUnauthorized: (() => void) | null = null;
/** El contexto de sesión registra aquí qué hacer ante un 401 de una ruta protegida. */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  /** false para /auth/login: allí un 401 significa credenciales incorrectas, no sesión vencida. */
  auth?: boolean;
}

async function request<T>(path: string, { method = 'GET', body, headers = {}, auth = true }: RequestOptions = {}): Promise<T> {
  const token = auth ? getToken() : null;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.');
  }

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    if (res.status === 401 && auth) onUnauthorized?.();
    const apiError = data?.error as { code?: string; message?: string; details?: FieldIssue[] } | undefined;
    const message =
      res.status >= 500
        ? 'Algo salió mal en el servidor. Inténtalo de nuevo en unos minutos.'
        : (apiError?.message ?? 'No pudimos completar la solicitud.');
    throw new ApiError(res.status, apiError?.code ?? 'UNKNOWN_ERROR', message, apiError?.details);
  }
  return data as T;
}

// ---------- Tipos ----------
export interface Balance {
  user_id: string;
  amount: string;
  currency: 'USD';
  updated_at: string;
}

export interface Movement {
  id: string;
  type: 'deposit' | 'withdrawal' | 'webhook_deposit';
  amount: string;
  currency: 'USD';
  balance_after: string;
  reference: string | null;
  created_at: string;
}

export interface MovementsPage {
  data: Movement[];
  pagination: { page: number; limit: number; total: number; total_pages: number };
}

// ---------- Endpoints ----------
export const api = {
  login: (email: string, password: string) =>
    request<{ access_token: string }>('/auth/login', { method: 'POST', body: { email, password }, auth: false }),

  getBalance: () => request<Balance>('/balances/me'),

  getMovements: (page: number, limit = 10) =>
    request<MovementsPage>(`/balances/me/transactions?page=${page}&limit=${limit}`),

  deposit: (amount: string, idempotencyKey: string) =>
    request<unknown>('/balances/me/deposits', {
      method: 'POST',
      body: { amount, currency: 'USD' },
      headers: { 'Idempotency-Key': idempotencyKey },
    }),

  withdraw: (amount: string, idempotencyKey: string) =>
    request<unknown>('/balances/me/withdrawals', {
      method: 'POST',
      body: { amount, currency: 'USD' },
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
};
