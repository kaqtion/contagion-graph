"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type Health } from "@/lib/api";

const LINKS = [
  { href: "/", label: "Console" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/explorer", label: "Explorer" },
  { href: "/backtest", label: "Backtest" },
  { href: "/method", label: "Method" },
];

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="var(--line-strong)" strokeWidth="1" />
      <circle cx="12" cy="12" r="2.6" fill="var(--origin)" />
      <circle cx="17.6" cy="8.6" r="1.7" fill="var(--hurt)" />
      <circle cx="5.2" cy="15.8" r="1.4" fill="var(--hurt)" />
      <circle cx="15.4" cy="21.9" r="1.2" fill="var(--help)" />
    </svg>
  );
}

export default function Nav() {
  const path = usePathname();
  const [health, setHealth] = useState<Health | null>(null);
  const [down, setDown] = useState(false);
  useEffect(() => {
    api<Health>("/health").then(setHealth).catch(() => setDown(true));
  }, []);
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/run") : path.startsWith(href));

  return (
    <header className="sticky top-0 z-30 h-14 border-b border-line bg-bg/80 backdrop-blur-xl">
      <div className="h-full px-4 sm:px-6 flex items-center gap-4 sm:gap-8">
        <Link href="/" className="group flex items-center gap-2.5 shrink-0" aria-label="Contagion Graph home">
          <span className="transition-transform duration-500 group-hover:rotate-90">
            <Logo size={24} />
          </span>
          <span className="hidden sm:inline text-[15px] font-medium tracking-tight">
            Contagion <span className="display italic text-[18px] text-muted">Graph</span>
          </span>
        </Link>
        <nav aria-label="Main" className="flex items-center gap-0.5 overflow-x-auto -mx-1 px-1 min-w-0">
          {LINKS.map((l) => {
            const on = active(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={on ? "page" : undefined}
                className={`relative px-3 py-1.5 rounded-full text-[13px] whitespace-nowrap transition-colors duration-200 ${
                  on ? "text-text bg-white/[0.06]" : "text-muted hover:text-text hover:bg-white/[0.03]"
                }`}
              >
                {l.label}
                {on && <span className="absolute left-1/2 -bottom-[11px] -translate-x-1/2 w-1 h-1 rounded-full bg-origin" />}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto hidden md:flex items-center gap-2 text-[11.5px] text-faint num shrink-0">
          {health ? (
            <>
              <span className="relative inline-flex w-1.5 h-1.5">
                <span className="absolute inset-0 rounded-full bg-ok" style={{ animation: "pulse-ring 2.4s ease-out infinite" }} />
                <span className="relative w-1.5 h-1.5 rounded-full bg-ok" />
              </span>
              <span>
                graph live · {health.graph.edges.toLocaleString()} links · {health.llm_enabled ? "AI on" : "AI off"}
              </span>
            </>
          ) : down ? (
            <span className="text-warn">API unreachable</span>
          ) : null}
        </div>
      </div>
    </header>
  );
}
