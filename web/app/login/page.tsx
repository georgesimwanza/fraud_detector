import Link from "next/link";
import { redirect } from "next/navigation";
import { Skyline } from "@/components/brand-backdrop";
import { LoginForm } from "@/components/login-form";
import { Wordmark } from "@/components/ui";
import { getSession } from "@/lib/session";

function safeNext(next: unknown): string {
  // Only same-origin paths — never "//host" or "/\host", which browsers treat as external.
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/dashboard";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[]>> }) {
  const next = safeNext((await searchParams).next);
  if (await getSession()) redirect(next);

  return (
    <div className="flex min-h-screen bg-page p-0 md:items-center md:justify-center md:p-8">
      <div className="flex w-full max-w-6xl flex-col overflow-hidden bg-surface shadow-[0_24px_70px_rgba(29,33,80,0.14)] md:min-h-[640px] md:flex-row md:rounded-2xl">
        {/* Brand panel */}
        <section className="relative flex flex-col overflow-hidden bg-navy px-8 pb-0 pt-8 text-white md:w-[42%] md:px-10 md:pt-10">
          <Link href="/" aria-label="Back to home" className="relative z-10">
            <Wordmark onDark />
          </Link>
          <h1 className="relative z-10 mt-12 text-[28px] font-black uppercase leading-[1.25] tracking-wide md:mt-16 md:text-[32px]">
            Score it <span className="text-[#7d91ff]">now</span>
            <br />
            Review it <span className="text-[#7d91ff]">fast</span>
            <br />
            Stop fraud <span className="text-[#7d91ff]">early</span>
          </h1>
          <p className="relative z-10 mt-4 max-w-xs text-sm text-white/70">
            Every payment scored by a deep-learning model the moment it arrives, with high-risk ones in front of your analysts.
          </p>
          <Skyline className="relative mt-8 h-48 w-full md:mt-auto md:h-72" />
        </section>

        {/* Form */}
        <section className="flex flex-1 flex-col px-6 py-8 md:px-14 md:py-10">
          <p className="text-right text-[13px] text-ink-2">
            Need an account? <span className="font-bold text-brand-600">Ask your administrator</span>
          </p>
          <div className="my-auto w-full max-w-md self-center pt-10 md:pt-0">
            <h2 className="text-2xl font-black uppercase tracking-wide text-ink">Welcome back!</h2>
            <p className="mt-2 text-sm text-ink-2">Sign in to review transactions and alerts.</p>
            <LoginForm next={next} />
          </div>
        </section>
      </div>
    </div>
  );
}
