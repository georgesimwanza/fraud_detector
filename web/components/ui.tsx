import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { isHighRisk, type AlertStatus, type Transaction } from "@/lib/schemas";
import { fmtProb, fmtThreshold } from "./format";

/** Hexagon badge with a shield and tick — the product mark. */
export function Logo({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden>
      <defs>
        <linearGradient id="logo-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7390ff" />
          <stop offset="1" stopColor="#3a51e6" />
        </linearGradient>
      </defs>
      <path d="M20 3.5 34.3 11.75v16.5L20 36.5 5.7 28.25v-16.5Z" fill="url(#logo-fill)" stroke="url(#logo-fill)" strokeWidth={3} strokeLinejoin="round" />
      <path d="M20 10.8 12.8 13.6v5.6c0 4.8 3.1 8.6 7.2 10.1 4.1-1.5 7.2-5.3 7.2-10.1v-5.6Z" fill="#fff" />
      <path d="m16.7 19.6 2.3 2.3 4.4-4.6" fill="none" stroke="#3f56ec" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark({ onDark = false, className = "" }: { onDark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <Logo className="h-9 w-9 shrink-0" />
      <span className={`whitespace-nowrap text-[15px] font-black uppercase leading-none tracking-wide ${onDark ? "text-white" : "text-ink"}`}>
        Fraud<span className="text-brand-500"> Detection</span>
      </span>
    </span>
  );
}

/** Uppercase card heading, as in the design reference ("RETIREMENT PLAN"). */
export function SectionTitle({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <h2 className={`text-[13px] font-extrabold uppercase tracking-[0.06em] text-ink ${className}`}>{children}</h2>;
}

export function Card({
  title,
  action,
  children,
  className = "",
  flush = false,
  id,
}: {
  title?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  flush?: boolean;
  id?: string;
}) {
  return (
    <section id={id} className={`min-w-0 scroll-mt-24 rounded-xl bg-surface shadow-card ${className}`}>
      {title && (
        <header className="flex flex-wrap items-center justify-between gap-3 px-5 pb-1 pt-5 md:px-6">
          <SectionTitle>{title}</SectionTitle>
          {action}
        </header>
      )}
      <div className={flush ? "pb-2 pt-2" : "px-5 pb-5 pt-3 md:px-6 md:pb-6"}>{children}</div>
    </section>
  );
}

/** Page heading row: a back link or title on the left, actions (Export / Save pills) on the right. */
export function PageHeader({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-flex items-center gap-2 text-sm font-semibold text-ink-2 hover:text-brand-600">
            <ArrowLeft size={16} aria-hidden /> {back.label}
          </Link>
        )}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-3">{children}</div>}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
const BUTTON: Record<ButtonVariant, string> = {
  primary: "btn-primary text-white",
  secondary: "bg-surface text-brand-600 shadow-card ring-1 ring-line hover:ring-brand-100",
  danger: "bg-critical text-white shadow-[0_6px_16px_rgba(229,72,77,0.28)] hover:brightness-105",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
};

export function buttonClass(variant: ButtonVariant = "primary", size: "md" | "sm" = "md") {
  const pad = size === "sm" ? "px-4 py-1.5 text-[13px]" : "px-6 py-2.5 text-sm";
  return `inline-flex items-center justify-center gap-2 rounded-full font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${BUTTON[variant]}`;
}

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "sm" }) {
  return <button {...props} className={`${buttonClass(variant, size)} ${className}`} />;
}

export const inputClass =
  "block w-full rounded-md border border-line bg-surface px-3.5 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15";
export const labelClass = "block text-[13px] font-semibold text-ink";

export function Field({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className={labelClass}>
      {label}
      <span className="mt-1.5 block">{children}</span>
      {hint && <span className="mt-1 block text-xs font-normal text-ink-2">{hint}</span>}
    </label>
  );
}

/** Segmented control for filters (one row above the content). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-full bg-surface p-1 text-[13px] shadow-card">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-4 py-1.5 font-bold transition-colors ${value === o.value ? "btn-primary text-white" : "text-ink-2 hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Tone = "blue" | "teal" | "amber" | "coral" | "violet" | "green";

export function IconTile({ tone, children, size = "h-12 w-12" }: { tone: Tone; children: React.ReactNode; size?: string }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-xl ${size}`}
      style={{ background: `var(--tile-${tone}-bg)`, color: `var(--tile-${tone}-fg)` }}
    >
      {children}
    </span>
  );
}

/** A figure in a soft tile: icon, label, the value in a boxed field, a footnote (the reference's "Current age" tiles). */
export function StatTile({
  label,
  value,
  icon,
  tone,
  footer,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  tone: Tone;
  footer?: React.ReactNode;
}) {
  return (
    <div className="h-full rounded-xl bg-surface p-5 shadow-card">
      <div className="flex items-center gap-4">
        <IconTile tone={tone}>{icon}</IconTile>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-ink-2">{label}</div>
          <div className="mt-1 text-[26px] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</div>
        </div>
      </div>
      {footer && <div className="mt-4 flex items-center gap-2 border-t border-line pt-3 text-[13px] text-ink-2">{footer}</div>}
    </div>
  );
}

/** Full-width highlight strip: an uppercase statement and one big figure ("YOU'LL NEED … $782,436.06"). */
export function SummaryBar({ label, value, children }: { label: React.ReactNode; value: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-surface px-5 py-4 shadow-card md:px-6">
      <div>
        <SectionTitle>{label}</SectionTitle>
        {children && <div className="mt-1 text-[13px] text-ink-2">{children}</div>}
      </div>
      <div className="text-2xl font-black tracking-tight text-ink tabular-nums">{value}</div>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <p className="px-5 py-12 text-center text-sm text-ink-2">{children}</p>;
}

// Status colours always ship with an icon and a text label — never colour alone.
function Chip({ color, icon, children }: { color: string; icon: string; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold text-ink"
      style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
    >
      <span aria-hidden className="text-[10px] leading-none" style={{ color }}>
        {icon}
      </span>
      {children}
    </span>
  );
}

export function RiskBadge({ tx }: { tx: Pick<Transaction, "status" | "riskLevel"> }) {
  if (tx.status === "scoring_failed") return <Chip color="var(--serious)" icon="■">Scoring failed</Chip>;
  if (tx.riskLevel === "high") return <Chip color="var(--critical)" icon="▲">High risk</Chip>;
  return <Chip color="var(--muted)" icon="●">Low risk</Chip>;
}

const ALERT_STATUS: Record<AlertStatus, { color: string; icon: string; label: string }> = {
  open: { color: "var(--warning)", icon: "●", label: "Open" },
  confirmed_fraud: { color: "var(--critical)", icon: "✕", label: "Confirmed fraud" },
  false_positive: { color: "var(--good)", icon: "✓", label: "False positive" },
};

export const alertStatusLabel = (s: AlertStatus) => ALERT_STATUS[s].label;

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const s = ALERT_STATUS[status];
  return (
    <Chip color={s.color} icon={s.icon}>
      {s.label}
    </Chip>
  );
}

export function LevelBadge({ level }: { level: "stable" | "moderate" | "significant" }) {
  if (level === "significant") return <Chip color="var(--critical)" icon="▲">Significant</Chip>;
  if (level === "moderate") return <Chip color="var(--warning)" icon="◆">Moderate</Chip>;
  return <Chip color="var(--good)" icon="✓">Stable</Chip>;
}

/** Probability as a number plus a small meter with the threshold marked. */
export function ProbabilityBar({ probability, threshold }: { probability: number | null; threshold: number }) {
  if (probability === null) return <span className="text-ink-2">—</span>;
  const over = isHighRisk(probability, threshold);
  return (
    <span className="inline-flex items-center gap-2" title={`Threshold ${fmtThreshold(threshold)}`}>
      <span className="relative block h-1.5 w-16 overflow-hidden rounded-full bg-track">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${probability * 100}%`, background: over ? "var(--critical)" : "var(--brand-500)" }}
        />
        <span className="absolute inset-y-0 w-px bg-ink" style={{ left: `${threshold * 100}%` }} />
      </span>
      <span className="w-12 text-right tabular-nums">{fmtProb(probability)}</span>
    </span>
  );
}

export function StubBadge({ onDark = false }: { onDark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-extrabold tracking-wider ${
        onDark ? "bg-[#ffd8d8] text-[#a11d1d]" : "border-2 border-critical text-critical"
      }`}
    >
      ⚠ STUB MODEL
    </span>
  );
}

/** Shared table chrome: a tinted header row with rounded ends. */
export const tableHeadRow = "bg-surface-2 text-left text-[12px] uppercase tracking-wide text-ink-2 [&>th:first-child]:rounded-l-lg [&>th:last-child]:rounded-r-lg";
