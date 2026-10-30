import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type Balance, type MovementsPage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { MoneyForm } from '../components/MoneyForm';
import { MovementList } from '../components/MovementList';
import { formatUsd } from '../lib/money';

type Loadable<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: T };

const messageOf = (err: unknown) => (err instanceof ApiError ? err.message : 'Ocurrió un error inesperado.');

export function BalancePage() {
  const { logout } = useAuth();
  const [balance, setBalance] = useState<Loadable<Balance>>({ status: 'loading' });
  const [movements, setMovements] = useState<Loadable<MovementsPage>>({ status: 'loading' });
  const [page, setPage] = useState(1);
  // Ignora respuestas viejas si el usuario cambia de página rápido.
  const latestPage = useRef(page);

  const loadBalance = useCallback(async () => {
    try {
      setBalance({ status: 'ready', value: await api.getBalance() });
    } catch (err) {
      setBalance({ status: 'error', message: messageOf(err) });
    }
  }, []);

  const loadMovements = useCallback(async (p: number) => {
    latestPage.current = p;
    setMovements({ status: 'loading' });
    try {
      const value = await api.getMovements(p);
      if (latestPage.current === p) setMovements({ status: 'ready', value });
    } catch (err) {
      if (latestPage.current === p) setMovements({ status: 'error', message: messageOf(err) });
    }
  }, []);

  useEffect(() => {
    void loadBalance();
  }, [loadBalance]);

  useEffect(() => {
    void loadMovements(page);
  }, [page, loadMovements]);

  function onOperationDone() {
    void loadBalance();
    if (page === 1) void loadMovements(1);
    else setPage(1);
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand">Orbita</span>
        <button type="button" className="btn btn-ghost" onClick={logout}>
          Cerrar sesión
        </button>
      </header>

      <main className="layout">
        <div className="stack">
          <section className="card balance" aria-labelledby="balance-title">
            <h2 id="balance-title">Saldo disponible</h2>
            {balance.status === 'loading' && <p role="status">Cargando saldo…</p>}
            {balance.status === 'error' && (
              <div className="stack">
                <p className="alert alert-error" role="alert">
                  {balance.message}
                </p>
                <button type="button" className="btn" onClick={() => void loadBalance()}>
                  Reintentar
                </button>
              </div>
            )}
            {balance.status === 'ready' && (
              <p className="balance-amount" data-testid="balance-amount">
                {formatUsd(balance.value.amount)}
              </p>
            )}
          </section>

          <MoneyForm onDone={onOperationDone} />
        </div>

        <MovementList state={movements} onPage={setPage} onRetry={() => void loadMovements(page)} />
      </main>
    </div>
  );
}
