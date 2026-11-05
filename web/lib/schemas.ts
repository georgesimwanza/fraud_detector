import { z } from "zod";

/**
 * The wire contract. Mirrored in inference/app/schemas.py and emitted by the simulator.
 * Model input order is fixed: Time, V1 … V28, Amount — and must match each bundle's metadata.json.
 */
export const FEATURE_ORDER: readonly string[] = [
  "Time",
  ...Array.from({ length: 28 }, (_, i) => `V${i + 1}`),
  "Amount",
];

// zod 4's z.number() already rejects NaN and ±Infinity.
const nonNegative = z.number().min(0);

export const TransactionInSchema = z.object({
  externalId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,64}$/, "must be 1–64 characters of A-Z, a-z, 0-9, _ or -")
    .optional(),
  time: nonNegative,
  amount: nonNegative,
  v: z.array(z.number()).length(28),
  // Evaluation only — never passed to the model.
  label: z.union([z.literal(0), z.literal(1)]).optional(),
}); // z.object strips unknown keys by default

export type TransactionIn = z.infer<typeof TransactionInSchema>;

/** Batch ingest envelope. Items are validated one by one so a bad record never sinks the batch (NFR5). */
export const MAX_BATCH = 500;
export const BatchInSchema = z.object({
  transactions: z.array(z.unknown()).min(1).max(MAX_BATCH),
});

export const RoleSchema = z.enum(["admin", "analyst"]);
export type Role = z.infer<typeof RoleSchema>;

export const ALERT_STATUSES = ["open", "confirmed_fraud", "false_positive"] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];
export type Decision = Exclude<AlertStatus, "open">;

export const ReviewSchema = z.object({
  decision: z.enum(["confirmed_fraud", "false_positive"]),
  note: z.string().trim().max(500).optional(),
});

export const ThresholdSchema = z.object({
  threshold: z.number().min(0.01).max(0.99),
});

const password = z.string().min(8, "must be at least 8 characters").max(200);

export const CreateUserSchema = z.object({
  email: z.email().max(254).transform((e) => e.trim().toLowerCase()),
  role: RoleSchema,
  password,
});

export const UpdateUserSchema = z
  .object({ role: RoleSchema.optional(), active: z.boolean().optional(), password: password.optional() })
  .refine((u) => u.role !== undefined || u.active !== undefined || u.password !== undefined, "Nothing to change.");

const isoDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
export const MAX_REPORT_DAYS = 366;
export const ReportQuerySchema = z
  .object({ from: isoDay, to: isoDay })
  .refine((q) => q.from <= q.to, "'from' must not be after 'to'.")
  .refine((q) => (Date.parse(q.to) - Date.parse(q.from)) / 86_400_000 < MAX_REPORT_DAYS, `A report covers at most ${MAX_REPORT_DAYS} days.`);

export const LoginSchema = z.object({
  email: z.email().max(254),
  password: z.string().min(1).max(200), // bcrypt only reads 72 bytes; the cap stops huge bodies
});

// Document shapes as the UI sees them. Timestamps are epoch milliseconds.

export type RiskLevel = "high" | "low";

/**
 * FR6: high risk when the score is AT OR ABOVE the threshold (≥), as in the design
 * document. A score exactly equal to the threshold raises an alert. Decided 2026-10-26.
 */
export function isHighRisk(probability: number, threshold: number): boolean {
  return probability >= threshold;
}

export interface Transaction {
  id: string;
  externalId: string;
  time: number;
  amount: number;
  v: number[];
  label?: 0 | 1;
  probability: number | null;
  riskLevel: RiskLevel | null;
  isAlert: boolean;
  status: "scored" | "scoring_failed";
  modelVersion: string | null;
  thresholdUsed: number;
  receivedAt: number;
  latencyMs: number;
  // Challenger score, recorded for comparison only — never decides an alert.
  shadowProbability: number | null;
  shadowModelVersion: string | null;
}

export interface Alert {
  id: string; // = transaction ID, so ingest retries are idempotent
  transactionId: string;
  amount: number;
  probability: number;
  thresholdUsed: number;
  modelVersion: string;
  status: AlertStatus;
  createdAt: number;
  reviewedBy: string | null;
  reviewedAt: number | null;
  note: string | null;
}

export interface DailyStats {
  date: string; // YYYY-MM-DD
  total: number;
  alerts: number;
  open: number;
  confirmedFraud: number;
  falsePositive: number;
  scoringFailed: number;
  latencySumMs: number;
}

export interface Config {
  threshold: number;
  activeModelVersion: string;
  activeModelStub: boolean;
}

export interface Actor {
  email: string;
  role: Role;
}

export const ALERT_SORTS = {
  newest: "Newest first",
  oldest: "Oldest first",
  probability: "Highest probability",
  amount: "Highest amount",
} as const;
export type AlertSort = keyof typeof ALERT_SORTS;

// ---- read models for reports, monitoring and administration --------------------------------------

export interface FeatureAttribution {
  feature: string; // FEATURE_ORDER name
  value: number; // raw (unscaled) input
  attribution: number; // share of (probability - baseline probability)
}

export interface Explanation {
  method: "integrated_gradients";
  modelVersion: string;
  probability: number;
  baselineProbability: number;
  residual: number;
  attributions: FeatureAttribution[];
}

/** Confusion counts at one threshold, over transactions carrying an evaluation label. */
export interface CurvePoint {
  threshold: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  missedFraudAmount: number; // sum of amounts of labelled fraud scored below the threshold
}

export interface Performance {
  n: number;
  positives: number;
  tp: number;
  fp: number;
  fn: number;
  tn: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export type DriftLevel = "stable" | "moderate" | "significant";

export interface FeatureDrift {
  feature: string;
  psi: number;
  level: DriftLevel;
}

export interface DriftReport {
  modelVersion: string;
  referenceFrom: number | null;
  referenceTo: number | null;
  currentFrom: number | null;
  currentTo: number | null;
  windowSize: number; // rows in each window
  score: FeatureDrift | null; // drift of the model's output
  features: FeatureDrift[]; // inputs, most drifted first
}

export interface ShadowComparison {
  activeModelVersion: string;
  shadowModelVersion: string;
  n: number;
  threshold: number;
  agreement: number; // share of transactions both models put on the same side of the threshold
  activeAlerts: number;
  shadowAlerts: number;
  meanAbsDifference: number;
  active: Performance; // on the labelled subset
  shadow: Performance;
}

export interface ReviewFeedback {
  reviewed: number;
  confirmedFraud: number;
  falsePositive: number;
  precision: number | null; // confirmed / reviewed
}

export interface ModelHealth {
  config: Config;
  suggestedThreshold: number | null;
  trainingMetrics: unknown;
  live: Performance; // active model, at the current threshold, on labelled traffic
  feedback: ReviewFeedback; // active model's alerts, as decided by analysts
  drift: DriftReport;
  shadow: ShadowComparison | null;
}

export interface ReportDay extends DailyStats {
  alertAmount: number;
  confirmedFraudAmount: number;
}

export interface Report {
  from: string;
  to: string;
  days: ReportDay[]; // every day in the range, zero-filled
  totals: ReportDay;
  avgLatencyMs: number | null;
  avgReviewMinutes: number | null;
  feedback: ReviewFeedback;
  labelled: Performance; // transactions in the period with an evaluation label, judged at their own threshold
  topAlerts: Alert[]; // highest probability in the period
}

export interface UserRow {
  id: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: number;
  lastLoginAt: number | null;
}

export interface AuditEntry {
  id: number;
  at: number;
  actorEmail: string | null;
  role: Role | null;
  action: string;
  target: string | null;
  before: unknown;
  after: unknown;
}
