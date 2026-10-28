// Small shared presentational pieces.
import type { ReactNode } from "react";
import { fmtImpact, impactColor } from "@/lib/format";

export function Badge({ children, tone = "neutral", title }: {
  children: ReactNode; tone?: "neutral" | "ok" | "warn" | "hurt" | "help" | "origin"; title?: string;
}) {
  const tones = {
    neutral: "border-line-strong text-muted",
    ok: "border-ok/40 text-ok bg-ok/10",
    warn: "border-warn/40 text-warn bg-warn/10",
    hurt: "border-hurt/40 text-hurt bg-hurt-soft",
    help: "border-help/40 text-help bg-help-soft",
    origin: "border-origin/40 text-origin bg-origin-soft",
  };
  return (
    <span title={title} className={`inline-flex items-center gap-1 rounded border px-1.5 py-px text-[10.5px] leading-4 whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function QualityBadge({ q, reasons, compact }: { q: "verified" | "speculative"; reasons?: string[]; compact?: boolean }) {
  return q === "verified" ? (
    <Badge tone="ok" title="Every edge on this path has a verbatim filing quote under 18 months old">quoted</Badge>
  ) : (
    <Badge tone="warn" title={reasons?.length ? reasons.join("\n") : "At least one edge has no quote, is stale or weak"}>
      {compact ? "spec." : "speculative"}
    </Badge>
  );
}

export function CoverageDot({ c }: { c: "high" | "medium" | "low" | "none" }) {
  const fill = { high: 3, medium: 2, low: 1, none: 0 }[c];
  return (
    <span className="inline-flex gap-[3px] align-middle" title={`Graph coverage: ${c}. How much of this company's network is backed by filings.`}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`w-[5px] h-[5px] rounded-full ${i < fill ? "bg-muted" : "bg-line-strong"}`} />
      ))}
    </span>
  );
}

export function ImpactBar({ v, max }: { v: number; max: number }) {
  const pct = Math.min(100, (Math.abs(v) / (max || 1)) * 100);
  return (
    <div className="flex items-center gap-2 min-w-[104px]">
      <div className="relative h-[6px] flex-1 bg-panel-2 rounded-full overflow-hidden">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-line-strong" />
        <div
          className="absolute top-0 bottom-0 rounded-full"
          style={{
            background: impactColor(v),
            width: `${pct / 2}%`,
            left: v < 0 ? `${50 - pct / 2}%` : "50%",
          }}
        />
      </div>
      <span className="num text-[12px] w-[52px] text-right" style={{ color: impactColor(v) }}>
        {fmtImpact(v)}
      </span>
    </div>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`bg-panel border border-line rounded-lg ${className}`}>{children}</section>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
      <h2 className="text-[11px] uppercase tracking-[0.08em] text-faint font-medium">{children}</h2>
      {right}
    </div>
  );
}
