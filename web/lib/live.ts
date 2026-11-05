/**
 * Live data seam for client components.
 *
 * One shared EventSource on /api/stream mirrors the server's view of the database.
 * Browsers never write directly; actions go through the route handlers.
 */
import type {
  Alert,
  AlertSort,
  AlertStatus,
  AuditEntry,
  Config,
  CurvePoint,
  DailyStats,
  Decision,
  Explanation,
  ModelHealth,
  Report,
  Role,
  Transaction,
  UserRow,
} from "./schemas";

type Unsubscribe = () => void;
export type Connection = "connecting" | "live" | "reconnecting";

type ServerEvent =
  | { type: "snapshot"; transactions: Transaction[]; alerts: Alert[]; stats: DailyStats; config: Config }
  | { type: "transaction"; transaction: Transaction }
  | { type: "alert"; alert: Alert }
  | { type: "stats"; stats: DailyStats }
  | { type: "config"; config: Config };

const MAX_TRANSACTIONS = 2_000;

const mirror = {
  loaded: false,
  connection: "connecting" as Connection,
  transactions: [] as Transaction[], // newest first
  byId: new Map<string, Transaction>(),
  alerts: new Map<string, Alert>(),
  stats: null as DailyStats | null,
  config: null as Config | null,
};

const listeners = new Set<() => void>();
let source: EventSource | null = null;

function notify() {
  listeners.forEach((l) => l());
}

function apply(e: ServerEvent) {
  switch (e.type) {
    case "snapshot":
      mirror.transactions = e.transactions;
      mirror.byId = new Map(e.transactions.map((t) => [t.id, t]));
      mirror.alerts = new Map(e.alerts.map((a) => [a.id, a]));
      mirror.stats = e.stats;
      mirror.config = e.config;
      mirror.loaded = true;
      break;
    case "transaction":
      mirror.transactions = [e.transaction, ...mirror.transactions];
      mirror.byId.set(e.transaction.id, e.transaction);
      if (mirror.transactions.length > MAX_TRANSACTIONS) {
        for (const t of mirror.transactions.splice(MAX_TRANSACTIONS)) if (!mirror.alerts.has(t.id)) mirror.byId.delete(t.id);
      }
      break;
    case "alert":
      mirror.alerts.set(e.alert.id, e.alert);
      break;
    case "stats":
      // Ignore late updates to an earlier day (e.g. reviewing yesterday's alert).
      if (!mirror.stats || e.stats.date >= mirror.stats.date) mirror.stats = e.stats;
      break;
    case "config":
      mirror.config = e.config;
      break;
  }
}

function connect() {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/stream");
  source.onopen = () => {
    mirror.connection = "live";
    notify();
  };
  source.onmessage = (msg) => {
    apply(JSON.parse(msg.data) as ServerEvent);
    notify();
  };
  source.onerror = () => {
    if (source?.readyState === EventSource.CLOSED) {
      // The server refused the stream (usually an expired session).
      window.location.assign("/login");
      return;
    }
    mirror.connection = "reconnecting"; // EventSource retries on its own and gets a fresh snapshot
    notify();
  };
}

/** Calls cb with select() whenever the mirror changes — but only once the first snapshot has arrived. */
function watch<T>(select: () => T, cb: (value: T) => void): Unsubscribe {
  connect();
  const listener = () => {
    if (mirror.loaded) cb(select());
  };
  listeners.add(listener);
  listener();
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeConnection(cb: (c: Connection) => void): Unsubscribe {
  connect();
  const listener = () => cb(mirror.connection);
  listeners.add(listener);
  listener();
  return () => {
    listeners.delete(listener);
  };
}

export function subscribeRecentTransactions(limit: number, cb: (txs: Transaction[]) => void): Unsubscribe {
  return watch(() => mirror.transactions.slice(0, limit), cb);
}

export function subscribeTransactionsWithin(minutes: number, cb: (txs: Transaction[]) => void): Unsubscribe {
  return watch(() => {
    const since = Date.now() - minutes * 60_000;
    return mirror.transactions.filter((t) => t.receivedAt >= since);
  }, cb);
}

export function subscribeTransaction(id: string, cb: (tx: Transaction | null) => void): Unsubscribe {
  return watch(() => mirror.byId.get(id) ?? null, cb);
}

const ALERT_ORDER: Record<AlertSort, (a: Alert, b: Alert) => number> = {
  newest: (a, b) => b.createdAt - a.createdAt,
  oldest: (a, b) => a.createdAt - b.createdAt,
  probability: (a, b) => b.probability - a.probability || b.createdAt - a.createdAt,
  amount: (a, b) => b.amount - a.amount || b.createdAt - a.createdAt,
};

/** Alerts in the live mirror (the latest 500 at connect, plus every one raised since), sorted, then capped. */
export function subscribeAlerts(status: AlertStatus | "all", cb: (alerts: Alert[]) => void, sort: AlertSort = "newest", limit = 200): Unsubscribe {
  return watch(
    () =>
      [...mirror.alerts.values()]
        .filter((a) => status === "all" || a.status === status)
        .sort(ALERT_ORDER[sort])
        .slice(0, limit),
    cb,
  );
}

export function subscribeAlert(id: string, cb: (alert: Alert | null) => void): Unsubscribe {
  return watch(() => mirror.alerts.get(id) ?? null, cb);
}

export function subscribeStats(cb: (stats: DailyStats) => void): Unsubscribe {
  return watch(() => mirror.stats!, cb);
}

export function subscribeConfig(cb: (config: Config) => void): Unsubscribe {
  return watch(() => mirror.config!, cb);
}

async function send(url: string, method: "PATCH" | "PUT" | "POST", body: unknown): Promise<void> {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`);
  }
  // The resulting change arrives through the stream like any other update.
}

export function reviewAlert(id: string, decision: Decision, note: string): Promise<void> {
  return send(`/api/alerts/${encodeURIComponent(id)}`, "PATCH", { decision, note: note.trim() || undefined });
}

export function updateThreshold(threshold: number): Promise<void> {
  return send("/api/admin/config/threshold", "PUT", { threshold });
}

// ---- request/response data (not streamed) ----------------------------------------------------------

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (HTTP ${res.status}).`);
  return data as T;
}

export interface ExplanationResult {
  explanation: Explanation;
  scoredBy: string; // model that raised the alert
  sameModel: boolean; // false: the model serving now differs, so this explains today's model, not the original score
}

export const fetchExplanation = (id: string) => getJson<ExplanationResult>(`/api/alerts/${encodeURIComponent(id)}/explanation`);

export const fetchReport = (from: string, to: string) => getJson<Report>(`/api/reports?from=${from}&to=${to}`);
export const reportCsvUrl = (from: string, to: string) => `/api/reports?from=${from}&to=${to}&format=csv`;

export const fetchModelHealth = () => getJson<ModelHealth>("/api/model");

export interface ThresholdCurve {
  modelVersion: string;
  n: number;
  positives: number;
  points: CurvePoint[];
}
export const fetchThresholdCurve = () => getJson<ThresholdCurve>("/api/model/threshold-curve");

export const fetchUsers = () => getJson<UserRow[]>("/api/admin/users");
export const createUser = (email: string, role: Role, password: string) => send("/api/admin/users", "POST", { email, role, password });
export const updateUser = (id: string, changes: { role?: Role; active?: boolean; password?: string }) =>
  send(`/api/admin/users/${encodeURIComponent(id)}`, "PATCH", changes);

export interface AuditPage {
  entries: AuditEntry[];
  actions: string[];
  nextBefore: number | null;
}
export function fetchAudit(q: { action?: string; actor?: string; before?: number }): Promise<AuditPage> {
  const params = new URLSearchParams();
  if (q.action) params.set("action", q.action);
  if (q.actor) params.set("actor", q.actor);
  if (q.before) params.set("before", String(q.before));
  return getJson<AuditPage>(`/api/admin/audit?${params}`);
}
