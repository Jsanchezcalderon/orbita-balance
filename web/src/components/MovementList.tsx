import type { Movement, MovementsPage } from '../api/client';
import { formatDateTime, formatUsd } from '../lib/money';

const TYPE_LABEL: Record<Movement['type'], string> = {
  deposit: 'Depósito',
  withdrawal: 'Retiro',
  webhook_deposit: 'Pago externo acreditado',
};

interface Props {
  state: { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; value: MovementsPage };
  onPage: (page: number) => void;
  onRetry: () => void;
}

export function MovementList({ state, onPage, onRetry }: Props) {
  return (
    <section className="card stack" aria-labelledby="history-title">
      <h2 id="history-title">Movimientos</h2>

      {state.status === 'loading' && <p role="status">Cargando movimientos…</p>}

      {state.status === 'error' && (
        <div className="stack">
          <p className="alert alert-error" role="alert">
            {state.message}
          </p>
          <button type="button" className="btn" onClick={onRetry}>
            Reintentar
          </button>
        </div>
      )}

      {state.status === 'ready' && state.value.data.length === 0 && (
        <p className="empty">Aún no tienes movimientos. Haz tu primer depósito para verlo aquí.</p>
      )}

      {state.status === 'ready' && state.value.data.length > 0 && (
        <>
          <ul className="movements">
            {state.value.data.map((m) => {
              const isDebit = m.type === 'withdrawal';
              return (
                <li key={m.id}>
                  <div>
                    <p className="movement-type">{TYPE_LABEL[m.type]}</p>
                    <p className="hint">{formatDateTime(m.created_at)}</p>
                  </div>
                  <div className="movement-amounts">
                    <p className={isDebit ? 'debit' : 'credit'}>
                      {isDebit ? '−' : '+'}
                      {formatUsd(m.amount)}
                    </p>
                    <p className="hint">Saldo {formatUsd(m.balance_after)}</p>
                  </div>
                </li>
              );
            })}
          </ul>

          <nav className="pager" aria-label="Paginación de movimientos">
            <button
              type="button"
              className="btn"
              disabled={state.value.pagination.page <= 1}
              onClick={() => onPage(state.value.pagination.page - 1)}
            >
              Anterior
            </button>
            <span>
              Página {state.value.pagination.page} de {state.value.pagination.total_pages}
            </span>
            <button
              type="button"
              className="btn"
              disabled={state.value.pagination.page >= state.value.pagination.total_pages}
              onClick={() => onPage(state.value.pagination.page + 1)}
            >
              Siguiente
            </button>
          </nav>
        </>
      )}
    </section>
  );
}
