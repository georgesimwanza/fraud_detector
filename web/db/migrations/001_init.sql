-- Initial schema. Applied by scripts/migrate.ts; never edit after it has run — add 002_*.sql.
-- CHECK constraints mirror the wire contract (web/lib/schemas.ts) so bad data cannot land
-- even if a code path forgets to validate.

CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,                        -- bcrypt
  role          text NOT NULL CHECK (role IN ('admin', 'analyst')),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE model_versions (
  version             text PRIMARY KEY,
  stub                boolean NOT NULL,
  trained_at          timestamptz,
  dataset             text,
  suggested_threshold double precision,
  metrics             jsonb,
  registered_at       timestamptz NOT NULL DEFAULT now()
);

-- Single-row table: the active configuration.
CREATE TABLE settings (
  id                   smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  threshold            double precision NOT NULL CHECK (threshold BETWEEN 0.01 AND 0.99),
  active_model_version text REFERENCES model_versions (version),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transactions (
  id             text PRIMARY KEY CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  time           double precision NOT NULL CHECK (time >= 0),
  amount         double precision NOT NULL CHECK (amount >= 0),
  v              double precision[] NOT NULL CHECK (cardinality(v) = 28),
  label          smallint CHECK (label IN (0, 1)),              -- evaluation only
  probability    double precision CHECK (probability BETWEEN 0 AND 1),
  risk_level     text CHECK (risk_level IN ('high', 'low')),
  is_alert       boolean NOT NULL,
  status         text NOT NULL CHECK (status IN ('scored', 'scoring_failed')),
  model_version  text,
  threshold_used double precision NOT NULL,
  received_at    timestamptz NOT NULL,
  latency_ms     integer NOT NULL CHECK (latency_ms >= 0),
  -- a scored row always has a probability, model and risk level; a failed one has none
  CHECK ((status = 'scored') = (probability IS NOT NULL AND model_version IS NOT NULL AND risk_level IS NOT NULL))
);
CREATE INDEX transactions_received_at ON transactions (received_at DESC);
CREATE INDEX transactions_alert_received_at ON transactions (is_alert, received_at DESC);

-- Alert id = transaction id, so an ingest retry can never raise a second alert.
CREATE TABLE alerts (
  id             text PRIMARY KEY REFERENCES transactions (id),
  amount         double precision NOT NULL,
  probability    double precision NOT NULL CHECK (probability BETWEEN 0 AND 1),
  threshold_used double precision NOT NULL,
  model_version  text NOT NULL,
  status         text NOT NULL CHECK (status IN ('open', 'confirmed_fraud', 'false_positive')),
  created_at     timestamptz NOT NULL,
  reviewed_by    uuid REFERENCES users (id),
  reviewed_at    timestamptz,
  note           text CHECK (length(note) <= 500)
);
CREATE INDEX alerts_status_created_at ON alerts (status, created_at DESC);
CREATE INDEX alerts_status_probability ON alerts (status, probability DESC);

-- Daily counters, so the dashboard and reports never scan transactions.
CREATE TABLE daily_stats (
  day             date PRIMARY KEY,
  total           integer NOT NULL DEFAULT 0,
  alerts          integer NOT NULL DEFAULT 0,
  open            integer NOT NULL DEFAULT 0,
  confirmed_fraud integer NOT NULL DEFAULT 0,
  false_positive  integer NOT NULL DEFAULT 0,
  scoring_failed  integer NOT NULL DEFAULT 0,
  latency_sum_ms  bigint  NOT NULL DEFAULT 0,
  CHECK (open >= 0 AND confirmed_fraud >= 0 AND false_positive >= 0)
);

CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_id    uuid REFERENCES users (id),
  actor_email text,                       -- kept even if the user is later renamed; attempted email on failed sign-in
  role        text,
  action      text NOT NULL,
  target      text,
  before      jsonb,
  after       jsonb
);
CREATE INDEX audit_logs_actor_at ON audit_logs (actor_id, at DESC);
CREATE INDEX audit_logs_action_at ON audit_logs (action, at DESC);

-- Audit records are append-only, enforced by the database for every role including the owner.
CREATE FUNCTION audit_logs_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only';
END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_append_only();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION audit_logs_append_only();
