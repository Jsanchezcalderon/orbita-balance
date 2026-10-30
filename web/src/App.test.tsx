import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './App';
import { server } from './test/server';

const API = 'http://localhost:3000';

const apiError = (status: number, code: string, message: string) =>
  HttpResponse.json({ error: { code, message } }, { status });

const movement = (id: number, type = 'deposit', amount = '10.00') => ({
  id: String(id),
  type,
  amount,
  currency: 'USD',
  balance_after: amount,
  reference: null,
  created_at: '2026-10-29T12:00:00.000Z',
});

function mockSession({ balance = '125.50', movements = [movement(1)] } = {}) {
  server.use(
    http.get(`${API}/balances/me`, () =>
      HttpResponse.json({ user_id: 'u_123', amount: balance, currency: 'USD', updated_at: '2026-10-29T12:00:00Z' }),
    ),
    http.get(`${API}/balances/me/transactions`, () =>
      HttpResponse.json({
        data: movements,
        pagination: { page: 1, limit: 10, total: movements.length, total_pages: 1 },
      }),
    ),
  );
}

describe('inicio de sesión', () => {
  it('muestra un mensaje entendible si las credenciales no son válidas', async () => {
    server.use(
      http.post(`${API}/auth/login`, () => apiError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.')),
    );
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Correo'), 'ana@orbita.test');
    await user.type(screen.getByLabelText('Contraseña'), 'incorrecta');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos.');
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled();
  });

  it('valida el formulario antes de llamar a la API', async () => {
    const user = userEvent.setup(); // onUnhandledRequest:'error' falla si se hiciera una petición
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));
    expect(screen.getByText('Ingresa un correo válido.')).toBeInTheDocument();
    expect(screen.getByText('Ingresa tu contraseña.')).toBeInTheDocument();
  });

  it('inicia sesión, muestra el saldo y permite cerrar sesión', async () => {
    mockSession();
    server.use(http.post(`${API}/auth/login`, () => HttpResponse.json({ access_token: 'tok-123' })));
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByLabelText('Correo'), 'ana@orbita.test');
    await user.type(screen.getByLabelText('Contraseña'), 'Ana12345!');
    await user.click(screen.getByRole('button', { name: 'Iniciar sesión' }));

    expect(await screen.findByTestId('balance-amount')).toHaveTextContent('$125.50');
    expect(localStorage.getItem('orbita.token')).toBe('tok-123');

    await user.click(screen.getByRole('button', { name: 'Cerrar sesión' }));
    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(localStorage.getItem('orbita.token')).toBeNull();
  });
});

describe('sesión', () => {
  it('se conserva al recargar la página', async () => {
    localStorage.setItem('orbita.token', 'tok-guardado');
    mockSession({ balance: '80.00' });
    render(<App />);
    expect(await screen.findByTestId('balance-amount')).toHaveTextContent('$80.00');
  });

  it('ante un 401 vuelve al login y explica por qué', async () => {
    localStorage.setItem('orbita.token', 'tok-vencido');
    server.use(
      http.get(`${API}/balances/me`, () => apiError(401, 'TOKEN_EXPIRED', 'Tu sesión expiró.')),
      http.get(`${API}/balances/me/transactions`, () => apiError(401, 'TOKEN_EXPIRED', 'Tu sesión expiró.')),
    );
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Inicia sesión' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/sesión expiró/i);
    expect(localStorage.getItem('orbita.token')).toBeNull();
  });
});

describe('saldo e historial', () => {
  beforeEach(() => localStorage.setItem('orbita.token', 'tok-test'));

  it('muestra el estado vacío cuando no hay movimientos', async () => {
    mockSession({ balance: '0.00', movements: [] });
    render(<App />);
    expect(await screen.findByText(/Aún no tienes movimientos/)).toBeInTheDocument();
  });

  it('muestra un error con opción de reintentar si falla el historial', async () => {
    mockSession();
    server.use(http.get(`${API}/balances/me/transactions`, () => apiError(500, 'INTERNAL_ERROR', 'boom')));
    render(<App />);
    expect(await screen.findByText(/Algo salió mal en el servidor/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
  });

  it('lista los movimientos con su signo', async () => {
    mockSession({ movements: [movement(2, 'withdrawal', '5.00'), movement(1, 'deposit', '30.00')] });
    render(<App />);
    expect(await screen.findByText('−$5.00')).toBeInTheDocument();
    expect(screen.getByText('+$30.00')).toBeInTheDocument();
  });
});

describe('depósitos y retiros', () => {
  beforeEach(() => localStorage.setItem('orbita.token', 'tok-test'));

  it('valida el monto antes de enviarlo', async () => {
    mockSession(); // sin handler POST: una petición fallaría el test
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('balance-amount');

    const amount = screen.getByLabelText('Monto (USD)');
    const submit = screen.getByRole('button', { name: 'Depositar' });

    await user.click(submit);
    expect(screen.getByText('Ingresa un monto.')).toBeInTheDocument();

    await user.type(amount, '10.999');
    await user.click(submit);
    expect(screen.getByText('El monto admite máximo 2 decimales.')).toBeInTheDocument();

    await user.clear(amount);
    await user.type(amount, '10000.01');
    await user.click(submit);
    expect(screen.getByText('El monto máximo por operación es 10,000 USD.')).toBeInTheDocument();

    await user.clear(amount);
    await user.type(amount, '0');
    await user.click(submit);
    expect(screen.getByText('El monto debe ser mayor que 0.')).toBeInTheDocument();
  });

  it('deshabilita el botón mientras se envía y refresca el saldo al terminar', async () => {
    let balance = '100.00';
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let sentKey: string | null = null;
    let sentBody: unknown;

    server.use(
      http.get(`${API}/balances/me`, () =>
        HttpResponse.json({ user_id: 'u_123', amount: balance, currency: 'USD', updated_at: '2026-10-29T12:00:00Z' }),
      ),
      http.get(`${API}/balances/me/transactions`, () =>
        HttpResponse.json({ data: [], pagination: { page: 1, limit: 10, total: 0, total_pages: 1 } }),
      ),
      http.post(`${API}/balances/me/deposits`, async ({ request }) => {
        sentKey = request.headers.get('Idempotency-Key');
        sentBody = await request.json();
        await gate;
        balance = '150.25';
        return HttpResponse.json({ transaction: movement(9, 'deposit', '50.25') }, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    render(<App />);
    expect(await screen.findByTestId('balance-amount')).toHaveTextContent('$100.00');

    await user.type(screen.getByLabelText('Monto (USD)'), '50.25');
    await user.click(screen.getByRole('button', { name: 'Depositar' }));

    expect(await screen.findByRole('button', { name: 'Procesando…' })).toBeDisabled();
    release();

    await waitFor(() => expect(screen.getByTestId('balance-amount')).toHaveTextContent('$150.25'));
    expect(screen.getByText(/Depósito acreditado/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Depositar' })).toBeEnabled();
    expect(sentBody).toEqual({ amount: '50.25', currency: 'USD' });
    expect(sentKey).toMatch(/\S+/);
  });

  it('muestra un mensaje claro si el retiro supera el saldo', async () => {
    mockSession();
    server.use(
      http.post(`${API}/balances/me/withdrawals`, () =>
        apiError(422, 'INSUFFICIENT_FUNDS', 'Saldo insuficiente para realizar el retiro.'),
      ),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('balance-amount');

    await user.click(screen.getByLabelText('Retirar'));
    await user.type(screen.getByLabelText('Monto (USD)'), '999');
    await user.click(screen.getByRole('button', { name: 'Retirar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Saldo insuficiente');
  });

  it('reutiliza la Idempotency-Key al reintentar tras un fallo de red', async () => {
    mockSession();
    const keys: (string | null)[] = [];
    let calls = 0;
    server.use(
      http.post(`${API}/balances/me/deposits`, ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'));
        calls += 1;
        if (calls === 1) return HttpResponse.error();
        return HttpResponse.json({ transaction: movement(1) }, { status: 201 });
      }),
    );
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('balance-amount');

    await user.type(screen.getByLabelText('Monto (USD)'), '20');
    await user.click(screen.getByRole('button', { name: 'Depositar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos conectar/);

    await user.click(screen.getByRole('button', { name: 'Depositar' }));
    await screen.findByText(/Depósito acreditado/);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });
});
