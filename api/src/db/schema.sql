-- Dinero siempre en centavos (BIGINT). Nunca floats.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS balances (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  amount_cents BIGINT NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id            BIGSERIAL PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  type          TEXT NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'webhook_deposit')),
  amount_cents  BIGINT NOT NULL CHECK (amount_cents > 0),
  balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
  reference     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tx_user_created
  ON transactions (user_id, created_at DESC, id DESC);

-- Una fila por (usuario, llave, operación). Guarda la respuesta para reenviarla.
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id      TEXT NOT NULL REFERENCES users(id),
  key          TEXT NOT NULL,
  endpoint     TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status_code  INT,
  response     JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key, endpoint)
);

-- La PK en event_id garantiza que un evento se procese una sola vez.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id     TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  status       TEXT NOT NULL CHECK (status IN ('approved', 'rejected')),
  amount_cents BIGINT NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
