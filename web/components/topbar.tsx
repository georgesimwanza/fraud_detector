"use client";

import { Bell, ChevronDown, LogOut, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { subscribeAlerts, subscribeConfig } from "@/lib/live";
import type { Actor, Alert, Config } from "@/lib/schemas";
import { StubBadge, Wordmark } from "./ui";
import { useLive } from "./use-live";

function initials(email: string): string {
  const name = email.split("@")[0].replace(/[^a-zA-Z]+/g, " ").trim();
  const parts = name.split(" ").filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

export function Topbar({ actor }: { actor: Actor }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const open = useLive<Alert[]>((cb) => subscribeAlerts("open", cb), []);
  const config = useLive<Config>(subscribeConfig, []);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    router.push(q ? `/alerts?q=${encodeURIComponent(q)}` : "/alerts");
  }

  return (
    <header data-chrome className="sticky top-0 z-20 flex h-16 items-center gap-4 bg-surface pr-4 shadow-[0_1px_0_var(--line)] md:pr-8">
      <Link href="/dashboard" className="flex h-full shrink-0 items-center px-4 md:w-60 md:px-6" aria-label="Fraud Detection — dashboard">
        <Wordmark />
      </Link>

      <div className="ml-auto flex items-center gap-4 md:gap-6">
        <form onSubmit={onSearch} role="search" className="relative hidden sm:block">
          <Search size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search alert ID"
            aria-label="Search alerts by transaction ID"
            className="w-48 rounded-full bg-surface-2 py-2 pl-10 pr-4 text-[13px] outline-none ring-1 ring-transparent placeholder:text-muted focus:ring-brand-500/40 lg:w-64"
          />
        </form>

        {config?.activeModelStub && (
          <span className="hidden lg:inline-flex">
            <StubBadge />
          </span>
        )}

        <Link href="/alerts" className="relative text-brand-500" aria-label={`${open?.length ?? 0} open alerts`}>
          <Bell size={21} fill="currentColor" strokeWidth={1.5} />
          {open && open.length > 0 && (
            <span className="absolute -right-2 -top-2 min-w-[18px] rounded-full bg-critical px-1 text-center text-[10px] font-bold leading-[18px] text-white ring-2 ring-surface tabular-nums">
              {open.length > 99 ? "99+" : open.length}
            </span>
          )}
        </Link>

        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-2 hover:bg-surface-2"
          >
            <span className="btn-primary flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white">{initials(actor.email)}</span>
            <span className="hidden text-left leading-tight md:block">
              <span className="block max-w-[180px] truncate text-[13px] font-bold">{actor.email}</span>
              <span className="block text-[11px] capitalize text-ink-2">{actor.role}</span>
            </span>
            <ChevronDown size={14} className="text-ink-2" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute right-0 mt-2 w-48 rounded-xl bg-surface p-1.5 shadow-[0_10px_30px_rgba(29,33,80,0.14)] ring-1 ring-line">
              <form action="/api/auth/logout" method="post">
                <button role="menuitem" className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-surface-2">
                  <LogOut size={16} /> Log out
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
