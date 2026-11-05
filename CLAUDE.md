# Payment Fraud Detection System — V1

Final-year project. A thin vertical slice: simulator → web ingest API → inference
service → PostgreSQL → live dashboard. Build only what the V1 definition of done needs.

**Decision (2026-10-26): PostgreSQL, not Firebase.** Matches the proposal's FR7 (relational
database) and NFR3 (bcrypt, JWT, parameterised queries). Firebase prompts no longer apply.

## Layout

```
web/          Next.js 15 App Router, TypeScript, Tailwind 4, zod 4, vitest
inference/    FastAPI + Keras (loads models/<version>/ once at startup)
training/     make_stub_bundle.py, train_cnn.py, evaluate_run.py
simulator/    simulate.py (stdlib only)
contract/     fixtures.json — shared good/bad payloads for BOTH contract test suites
docs/         requirements-coverage.md — FR/NFR traceability; update when a requirement moves
web/db/migrations/   numbered .sql files; never edit one that has run — add the next number
web/scripts/  migrate.ts, create-user.ts, seed-config.ts (run with tsx, see below)
models/       bundles (git-ignored); models/shadow/<v>/ = challenger bundles (not scanned for the active one)
data/splits/test.csv (git-ignored)
.venv/        one Python venv shared by inference/, training/, simulator/
```

## The contract (defined in three places — keep them identical)

Exactly 30 features, fixed order: `Time, V1 … V28, Amount`.

```json
{ "externalId": "tx-000123", "time": 406, "amount": 149.62, "v": [28 floats], "label": 0 }
```

- `externalId`: optional (explicit null rejected), 1–64 chars, `[A-Za-z0-9_-]`; generated if absent.
- `time`, `amount`: finite numbers ≥ 0. No string/boolean coercion (pydantic uses Strict).
- `v`: exactly 28 finite numbers.
- `label`: optional 0|1. **Evaluation only — never passed to the model.**
- Unknown fields stripped.

Sources: `web/lib/schemas.ts` (zod), `inference/app/schemas.py` (pydantic), simulator emitter.
Any contract change: update both, add a case to `contract/fixtures.json`, run both test suites.
Feature order also lives in each bundle's `metadata.json`; inference refuses to start on mismatch.

Inference API (header `X-Internal-Key`): `POST /predict` body `{"transactions": [...]}` →
`{model_version, stub, probabilities, latency_ms, shadow: {model_version, stub, probabilities} | null}`;
`POST /explain` body `{"transaction": {...}}` → integrated-gradients attributions per feature (30, FEATURE_ORDER),
`probability`, `baseline_probability`, `residual`; `GET /health` → `{status, model_version, stub, shadow_model_version}`.
`SHADOW_MODEL_BUNDLE` (optional) loads a challenger: scored on every request, stored, never raises an alert.
Ingest API (header `X-Api-Key`): `POST /api/transactions` → 201 / 400 / 401 / 409 / 503;
`POST /api/transactions/batch` `{"transactions": [≤500]}` → 200 with a per-record result
(`scored | scoring_failed | duplicate | invalid`), one inference call and ONE database transaction per batch.
Both run the same pipeline, `web/app/api/transactions/ingest.ts` (route-level, so it may coordinate lib modules).

## Data, auth and live updates

- **PostgreSQL 18** on localhost:5432. Databases `fraud_detection` (app) and
  `fraud_detection_test` (vitest only), both owned by role `fraud_app`. The app never uses the
  `postgres` superuser. Schema: `web/db/migrations/001_init.sql`.
- `web/lib/db.ts` — the one `pg` Pool. `web/lib/store.ts` — all persistence; every query
  parameterised; ingest and alert review each run in ONE database transaction (review locks
  the alert row `FOR UPDATE`), so `daily_stats` always equals a recount
  (asserted in `web/lib/store.test.ts`).
- Auth: bcrypt (cost 12) password hashes in `users`; sign-in issues an HS256 JWT
  (`SESSION_SECRET`, 2 h) in an HTTP-only, Secure, SameSite=Lax cookie. `getSession()` verifies
  the JWT then re-reads role + `active` from `users` on every request — role changes and
  deactivation apply immediately. Unknown emails still pay a bcrypt compare (no timing oracle).
- `scripts/create-user.ts` is **the only way to create the first admin**. After that, admins manage
  users at `/admin/users` (create, role, deactivate, reset password; audited). `updateUser` refuses to
  leave zero active admins and refuses an admin removing their own access.
- `settings` (single row) holds the threshold; missing ⇒ ingest returns 503 naming
  `seed-config.ts`, never a default threshold. 5 s threshold cache per server process.
- `audit_logs` is append-only, enforced by triggers (UPDATE/DELETE/TRUNCATE raise).
  Audited: sign-in, failed sign-in, sign-out, alert review, threshold change, scripts.
- Live updates: committed changes are emitted in-process and pushed over `GET /api/stream`
  (SSE) to `web/lib/live.ts`. Assumes one Next.js server process.

## UI

Light theme modelled on a navy/blue fintech UI kit (tokens in `web/app/globals.css`): white top bar
with the hexagon logo across the full width, deep-navy sidebar (grouped sections, gradient-pill active
item), white cards with UPPERCASE section titles, gradient pill buttons (`.btn-primary`), `SummaryBar`
highlight strips, navy chart tooltips. Shared pieces live in `components/ui.tsx`. Chart series
blue/teal/coral passed the dataviz palette validator; every chart has a legend and a table view. Nunito is bundled locally
(`@fontsource-variable/nunito` via `next/font/local`) — never load assets from the internet;
the app must render offline (NFR7). `/` is a
public landing page (excluded from the middleware matcher); its hero image
`web/public/dashboard-preview.png` is a real screenshot of `/dashboard` — retake it if the
dashboard changes. App shell = top bar with alert-ID search → `/alerts?q=` (`components/topbar.tsx`) + navy sidebar
(`components/nav.tsx`). Pages: dashboard, alerts (+ detail with "Why it was flagged"), reports,
model health; admin: users, audit log, settings (threshold what-if curve + cost model).

## Tables

- `transactions` — features (`v` = float8[28]), `probability` (null if scoring failed),
  `risk_level`, `is_alert`, `status: scored | scoring_failed`, `model_version`,
  `threshold_used`, `received_at`, `latency_ms` (receipt → decision), optional `label`,
  `shadow_probability` + `shadow_model_version` (both or neither; 002).
- `alerts` — **id = transaction id** (FK). `status: open | confirmed_fraud | false_positive`,
  `reviewed_by` → users, `note` ≤ 500, `explanation` jsonb (cached on first view, only when the
  explaining model is the scoring model; never computed on the ingest path).
- `daily_stats` (day PK) — counters, upserted with `ON CONFLICT … DO UPDATE`.
- `settings` (one row), `model_versions`, `users`, `audit_logs`.

## Rules that must hold

- Browsers never touch the database. All writes go through route handlers → `lib/store.ts`.
- Every server lib file imports `server-only`.
- Role (`admin | analyst`) lives in `users.role`. Role checks in server code (pages + route
  handlers); `middleware.ts` only checks a cookie exists.
- Dependencies one way: pages → route handlers → `lib/` → store / inference. A lib file never
  imports a route, page, or another lib helper. Exceptions: `lib/schemas.ts` (the contract) and
  `lib/db.ts` (the connection pool). `lib/analytics.ts` is pure (no I/O): routes fetch rows from
  the store and pass them in (threshold curve, PSI drift, shadow comparison, reports, CSV).
  Route handlers are the only coordinators.
- Training and app code never import each other; they meet only at `models/<version>/`
  (the inference API test runs `make_stub_bundle.py` as a subprocess for this reason).
- Every prediction records `modelVersion` and `thresholdUsed`.
- **FR6 decision (2026-10-26): high risk ⇔ probability ≥ threshold** (at or above, per the
  design document; the proposal's "exceeds" is superseded). One implementation:
  `isHighRisk()` in `web/lib/schemas.ts`; the equality boundary is asserted in
  `web/lib/schemas.test.ts`. Never re-implement the comparison inline.
- Analysts act only on open alerts; admins may change a decision. Reviews + threshold
  changes write audit entries.
- Simulator default 3 tx/s, warns above 5/s in single mode (every transaction updates the day's
  stats row); `--batch N` uses the batch endpoint (one stats-row update per request).
- Drift (Model health) compares the active model's first and latest ≤1,000 scored rows by PSI;
  Time is excluded (a replay only moves forward). Feedback CSV warns: simulator rows are TEST-split
  rows — never add them to training data.
- Stub bundles (`"stub": true`) always show a "STUB MODEL" badge in the UI.
- Structured JSON logs in both services (`lib/log.ts`, `inference/app/main.py`).

## Run commands (Windows PowerShell, from repo root)

```
# one-time
py -3.12 -m venv .venv; .venv\Scripts\pip install -r inference\requirements.txt -r training\requirements.txt
cd web; npm install; cd ..
.venv\Scripts\python training\make_stub_bundle.py
cd web
npx tsx --env-file=.env.local scripts/migrate.ts            # and again with --test
npx tsx --env-file=.env.local scripts/seed-config.ts        # active model + threshold
npx tsx --env-file=.env.local scripts/create-user.ts --email you@example.com --role admin
cd ..

# three terminals
cd inference; ..\.venv\Scripts\uvicorn app.main:app --port 8000 --env-file .env
cd web; npm run dev                                   # http://localhost:3000
.venv\Scripts\python simulator\simulate.py --synthetic --rate 3 --count 200 --fraud-share 0.1

# optional shadow model (champion vs challenger on /model)
.venv\Scripts\python training\make_stub_bundle.py --bias -4 --version stub-challenger --out models\shadow
cd inference; $env:SHADOW_MODEL_BUNDLE="..\models\shadow\stub-challenger"; ..\.venv\Scripts\uvicorn app.main:app --port 8000 --env-file .env

# NFR1 batch load test, then read latency from the run log
.venv\Scripts\python simulator\simulate.py --synthetic --rate 500 --count 5000 --fraud-share 0.05 --batch 100

# tests
cd web; npm test; npx tsc --noEmit; npx eslint .     # npm test needs PostgreSQL running
cd inference; ..\.venv\Scripts\python -m pytest

# evaluation / real training
.venv\Scripts\python training\evaluate_run.py --jsonl simulator\runs\<run>.jsonl
.venv\Scripts\python training\train_cnn.py --csv path\to\creditcard.csv
```

Secrets: `web/.env.local` (DATABASE_URL(_TEST), SESSION_SECRET, ingest key SHA-256, inference key), `inference/.env`,
`simulator/.env` — all git-ignored; templates are the `.env.example` files.

## Build order status

1. Contract + stub bundle + inference `/health` — done.
2. PostgreSQL, migrations, real login (bcrypt + JWT), roles, audit — done.
3. Ingest endpoint + simulator — done.
4. Dashboard + alerts + disposition — done.
5. Threshold setting — done.
6. Batch ingest (NFR1), recent-alerts panel (FR8), alert sorting (FR9), reports (FR10), user
   management (FR11), audit viewer (FR12) — done (2026-10-31).
7. Explainability (integrated gradients), analyst feedback loop + CSV export, threshold what-if
   + cost model, PSI drift monitoring, shadow (challenger) model, UI restyle — done (2026-10-31).
Next: evaluation work (Prompt C); HTTPS + login rate limiting (NFR3 gaps).
