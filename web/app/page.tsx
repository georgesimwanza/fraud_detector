import { ArrowRight, BellRing, BrainCircuit, ChevronDown, ClipboardCheck, Gauge, History, KeyRound, ScanSearch, SlidersHorizontal, Zap } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { BrandBackdrop } from "@/components/brand-backdrop";
import { IconTile, Logo, type Tone } from "@/components/ui";
import { getSession } from "@/lib/session";

const NAV = [
  { href: "#top", label: "Home" },
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#faq", label: "FAQ" },
  { href: "#contact", label: "Contact Us" },
];

const FEATURES: { icon: React.ReactNode; tone: Tone; title: string; body: string }[] = [
  {
    icon: <Zap size={26} strokeWidth={2.2} />,
    tone: "amber",
    title: "Real-time scoring",
    body: "Every transaction is scored as it arrives, with an 800 ms budget. If scoring fails the transaction is still stored, never dropped.",
  },
  {
    icon: <BrainCircuit size={26} strokeWidth={2.2} />,
    tone: "violet",
    title: "Deep-learning model",
    body: "A 1-D convolutional network built for the 284,807-transaction ULB card dataset, using SMOTE and class weighting for its 0.172% fraud rate.",
  },
  {
    icon: <ClipboardCheck size={26} strokeWidth={2.2} />,
    tone: "green",
    title: "Analyst review",
    body: "High-risk transactions become alerts. Analysts confirm fraud or clear false positives; every decision is audit-logged.",
  },
  {
    icon: <SlidersHorizontal size={26} strokeWidth={2.2} />,
    tone: "coral",
    title: "Tunable threshold",
    body: "Admins set the alert threshold with a live preview. Each transaction keeps the threshold and model version it was judged under.",
  },
];

const STEPS = [
  { icon: <KeyRound size={22} />, title: "Ingest", body: "Transactions are posted with an API key and validated against a strict 30-feature contract." },
  { icon: <Gauge size={22} />, title: "Score", body: "The inference service returns a fraud probability from the active model." },
  { icon: <BellRing size={22} />, title: "Alert", body: "At or above the threshold, an alert is raised and the dashboard updates live." },
  { icon: <ScanSearch size={22} />, title: "Review", body: "An analyst investigates and records a decision; the counters and audit log follow." },
];

const FAQ = [
  {
    q: "What data does the model use?",
    a: "Thirty numeric features per transaction: Time, Amount and 28 anonymised PCA components (V1–V28), the format of the public ULB credit-card fraud dataset. Card numbers and personal details are never needed.",
  },
  {
    q: "Why not just flag anything above 50%?",
    a: "Fraud is only 0.172% of transactions, so 0.5 is the wrong default. The suggested threshold is chosen from the validation precision–recall curve to maximise F1 on the fraud class, and admins can adjust it.",
  },
  {
    q: "Who can change decisions and settings?",
    a: "Analysts can act on open alerts. Admins can also change an existing decision and set the alert threshold. Roles are enforced on the server, not just hidden in the interface.",
  },
  {
    q: "Is the dataset label used for scoring?",
    a: "No. The label travels with simulated transactions only so the run can be evaluated afterwards (precision, recall, F1, ROC-AUC, PR-AUC). It is never passed to the model.",
  },
];

export default async function Landing() {
  const session = await getSession();
  const cta = session ? { href: "/dashboard", label: "Open dashboard" } : { href: "/login", label: "Sign In" };

  return (
    <div id="top" className="bg-page">
      <BrandBackdrop>
        <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 pt-6 md:px-10 md:pt-8">
          <Link href="/" aria-label="Fraud Detection home" className="[--logo-hole:var(--brand-700)]">
            <Logo className="h-11 w-11 text-[#0b0f1c]" />
          </Link>
          <nav className="hidden items-center gap-1 rounded-full bg-brand-950 p-2 lg:flex">
            {NAV.map((n, i) => (
              <a
                key={n.href}
                href={n.href}
                className={`rounded-full px-5 py-2 text-[17px] transition-colors ${
                  i === 0 ? "bg-white font-semibold text-brand-950" : "text-white/90 hover:bg-white/10"
                }`}
              >
                {n.label}
              </a>
            ))}
          </nav>
          <Link href={cta.href} className="rounded-2xl bg-brand-950 px-6 py-3 text-lg font-bold hover:bg-[#071437]">
            {cta.label}
          </Link>
        </header>

        <section className="mx-auto max-w-5xl px-5 pb-14 pt-20 text-center md:pt-28">
          <h1 className="text-4xl font-extrabold leading-[1.15] tracking-tight sm:text-5xl md:text-6xl">
            Protect Your Payments from
            <br className="hidden sm:block" /> Fraud, in Real Time
          </h1>
          <p className="mx-auto mt-7 max-w-3xl text-lg text-white/90 md:text-2xl md:leading-relaxed">
            A deep-learning fraud detection platform that scores every transaction as it arrives and puts high-risk payments in front of
            your analysts.
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              href={cta.href}
              className="inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3 text-base font-bold text-brand-800 hover:bg-white/90"
            >
              {session ? "Open dashboard" : "Get started"} <ArrowRight size={18} />
            </Link>
            <a href="#how-it-works" className="rounded-2xl border border-white/40 px-6 py-3 text-base font-bold hover:bg-white/10">
              How it works
            </a>
          </div>
        </section>

        <div className="mx-auto max-w-6xl px-5 md:px-10">
          <div className="overflow-hidden rounded-t-[28px] bg-white shadow-[0_-10px_60px_rgba(5,20,70,0.35)]">
            <div className="flex items-center gap-2.5 px-7 py-5">
              <span className="h-4 w-4 rounded-full bg-brand-600" />
              <span className="h-4 w-4 rounded-full bg-[#b9c9f2]" />
              <span className="h-4 w-4 rounded-full bg-[#e5ebfa]" />
            </div>
            <Image
              src="/dashboard-preview.png"
              alt="The live fraud dashboard: today's counters, transactions per minute, and the latest scored transactions"
              width={1600}
              height={900}
              priority
              className="block h-auto w-full"
            />
          </div>
        </div>
      </BrandBackdrop>

      <section id="features" className="mx-auto max-w-7xl scroll-mt-6 px-5 py-20 md:px-10">
        <p className="text-sm font-bold uppercase tracking-widest text-brand-600">Features</p>
        <h2 className="mt-2 max-w-2xl text-3xl font-extrabold tracking-tight md:text-4xl">Everything an analyst team needs to stop fraud early</h2>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl bg-surface p-6 shadow-card">
              <IconTile tone={f.tone}>{f.icon}</IconTile>
              <h3 className="mt-5 text-lg font-bold">{f.title}</h3>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-6 bg-surface py-20">
        <div className="mx-auto max-w-7xl px-5 md:px-10">
          <p className="text-sm font-bold uppercase tracking-widest text-brand-600">How it works</p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight md:text-4xl">From payment to decision in four steps</h2>
          <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative rounded-2xl border border-line bg-page p-6">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">{s.icon}</span>
                  <span className="text-sm font-bold text-ink-2">Step {i + 1}</span>
                </div>
                <h3 className="mt-4 text-lg font-bold">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-8 flex items-start gap-3 rounded-2xl bg-brand-50 p-5 text-[15px] text-brand-950">
            <History size={20} className="mt-0.5 shrink-0 text-brand-600" />
            <p>
              Every prediction records the model version and threshold it was judged under, so past decisions stay explainable after the model
              or the threshold changes.
            </p>
          </div>
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-4xl scroll-mt-6 px-5 py-20 md:px-10">
        <p className="text-center text-sm font-bold uppercase tracking-widest text-brand-600">FAQ</p>
        <h2 className="mt-2 text-center text-3xl font-extrabold tracking-tight md:text-4xl">Frequently asked questions</h2>
        <div className="mt-10 flex flex-col gap-3">
          {FAQ.map((f) => (
            <details key={f.q} className="group rounded-2xl bg-surface p-5 shadow-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-bold">
                {f.q}
                <ChevronDown size={20} className="shrink-0 text-ink-2 transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-ink-2">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="contact" className="scroll-mt-6 px-5 pb-20 md:px-10">
        <BrandBackdrop className="mx-auto max-w-6xl rounded-3xl px-6 py-14 text-center">
          <h2 className="text-3xl font-extrabold tracking-tight md:text-4xl">Contact Us</h2>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-white/90">
            Payment Fraud Detection System — a final-year project. For questions about the system or a demonstration, contact the project team.
          </p>
          <Link
            href={cta.href}
            className="mt-8 inline-flex items-center gap-2 rounded-2xl bg-white px-6 py-3 font-bold text-brand-800 hover:bg-white/90"
          >
            {session ? "Open dashboard" : "Sign in"} <ArrowRight size={18} />
          </Link>
        </BrandBackdrop>
      </section>

      <footer className="border-t border-line py-8 text-center text-sm text-ink-2">
        © {new Date().getFullYear()} Payment Fraud Detection System · Final-year project
      </footer>
    </div>
  );
}
