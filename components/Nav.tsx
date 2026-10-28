"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/run") : path.startsWith(href));
  return (
    <header className="border-b border-line bg-bg/90 backdrop-blur sticky top-0 z-30">
      <div className="px-4 sm:px-6 h-12 flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <Logo />
          <span className="font-semibold tracking-tight text-[15px]">Contagion Graph</span>
        </Link>
        <nav className="flex items-center gap-1 overflow-x-auto -mx-1">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-2.5 py-1 rounded-md text-[13px] whitespace-nowrap transition-colors ${
                active(l.href) ? "bg-raise text-text" : "text-muted hover:text-text"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
