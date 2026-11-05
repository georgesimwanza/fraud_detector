-- Shadow (challenger) scores, cached alert explanations, and indexes for the model-monitoring
-- and report queries. Applied by scripts/migrate.ts.

-- A shadow model scores every transaction alongside the active one but never raises an alert.
ALTER TABLE transactions
  ADD COLUMN shadow_probability   double precision CHECK (shadow_probability BETWEEN 0 AND 1),
  ADD COLUMN shadow_model_version text,
  ADD CHECK ((shadow_probability IS NULL) = (shadow_model_version IS NULL));

-- Per-feature attributions (integrated gradients), computed on first view of the alert and
-- cached only when the model that explained it is the model that scored it.
ALTER TABLE alerts ADD COLUMN explanation jsonb;

-- Drift, live performance and shadow comparison read one model's scored rows, newest or oldest first.
CREATE INDEX transactions_model_received_at ON transactions (model_version, received_at);
-- Reports read alerts by creation day.
CREATE INDEX alerts_created_at ON alerts (created_at);
