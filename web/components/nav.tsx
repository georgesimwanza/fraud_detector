"use client";

import { Activity, FileBarChart2, LayoutDashboard, ScrollText, Settings, ShieldAlert, Users, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { subscribeAlerts, subscribeConfig } from "@/lib/live";
import type { Actor, Alert, Config } from "@/lib/schemas";
import { StubBadge } from "./ui";
import { useLive } from "./use-live";

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
  count?: number;
}

export function Nav({ actor }: { actor: Actor }) {
  const pathname = usePathname();
  const config = useLive<Config>(subscribeConfig, []);
  const open = useLive<Alert[]>((cb) => subscribeAlerts("open", cb), []);

  const sections: { label?: string; items: Item[] }[] = [
    {
      items: [
        { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
        { href: "/alerts", label: "Alerts", icon: ShieldAlert, count: open?.length },
        { href: "/reports", label: "Reports", icon: FileBarChart2 },
        { href: "/model", label: "Model health", icon: Activity },
      ],
    },
    ...(actor.role === "admin"
      ? [
          {
            label: "Administration",
            items: [
              { href: "/admin/users", label: "Users", icon: Users },
              { href: "/admin/audit", label: "Audit log", icon: ScrollText },
              { href: "/admin/settings", label: "Settings", icon: Settings },
            ],
          },
        ]
      : []),
  ];

  return (
    <aside className="no-print bg-navy text-white md:sticky md:top-16 md:flex md:h-[calc(100vh-4rem)] md:w-60 md:shrink-0 md:flex-col md:overflow-y-auto">
      <nav className="flex gap-1 overflow-x-auto px-3 py-2 md:flex-col md:gap-0 md:px-3 md:py-5">
        {sections.map((section, s) => (
          <div key={s} className="flex gap-1 md:mb-4 md:flex-col md:gap-1">
            {section.label && (
              <div className="hidden px-3 pb-1 pt-3 text-[11px] font-semibold text-white/45 md:block">{section.label}</div>
            )}
            {section.items.map(({ href, label, icon: Icon, count }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold transition-colors ${
                    active ? "btn-primary text-white" : "text-white/75 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  <Icon size={18} strokeWidth={2.2} aria-hidden />
                  <span className="flex-1 whitespace-nowrap">{label}</span>
                  {count ? (
                    <span className="rounded-full bg-critical px-2 text-[11px] font-bold leading-5 text-white tabular-nums">{count > 99 ? "99+" : count}</span>
                  ) : null}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {config && (
        <div className="mx-3 mb-5 mt-auto hidden rounded-xl bg-navy-2 p-4 text-xs md:block">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/50">Active model</div>
          <code className="mt-1.5 block break-all font-mono text-[12px] text-white">{config.activeModelVersion}</code>
          {config.activeModelStub && (
            <div className="mt-2">
              <StubBadge onDark />
            </div>
          )}
          <div className="mt-3 flex items-center justify-between text-white/60">
            Alert threshold <span className="font-bold text-white tabular-nums">{config.threshold.toFixed(2)}</span>
          </div>
        </div>
      )}
    </aside>
  );
}
