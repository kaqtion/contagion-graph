"use client";

import { useMemo, useState } from "react";
import type { Exposure } from "@/lib/api";
import { CoverageDot, ImpactBar, QualityBadge } from "@/components/ui";

type Filter = "all" | "hurt" | "helped" | "mine";

export default function ExposureTable({
  rows, selected, onSelect, onHover, holdings,
}: {
  rows: Exposure[];
  selected: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
  holdings: Set<string>;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const list = useMemo(() => {
    const base = rows.filter((r) => !r.is_origin);
    if (filter === "hurt") return base.filter((r) => r.impact < 0);
    if (filter === "helped") return base.filter((r) => r.impact > 0);
    if (filter === "mine") return base.filter((r) => holdings.has(r.id) || (r.ticker && holdings.has(r.ticker)));
    return base;
  }, [rows, filter, holdings]);
  const max = Math.max(0.01, ...rows.filter((r) => !r.is_origin).map((r) => Math.abs(r.impact)));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="mx-4 mb-2.5 inline-flex self-start items-center gap-0.5 p-0.5 rounded-lg bg-white/[0.03] border border-line" role="tablist">
        {(["all", "hurt", "helped", "mine"] as Filter[]).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => setFilter(f)}
            className={`px-2.5 py-1 rounded-md text-[12px] capitalize transition-all duration-200 ${
              filter === f ? "bg-raise text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]" : "text-muted hover:text-text"
            }`}
          >
            {f === "mine" ? `My holdings${holdings.size ? ` (${holdings.size})` : ""}` : f}
          </button>
        ))}
      </div>
      <div className="overflow-auto min-h-0 flex-1">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-[#0e1013]/95 backdrop-blur z-10">
            <tr className="text-faint text-[11px] num">
              <th className="text-left font-normal pl-4 pr-1 py-2 w-10">#</th>
              <th className="text-left font-normal py-2">company</th>
              <th className="text-left font-normal py-2 px-1 w-10">hop</th>
              <th className="text-left font-normal py-2">impact</th>
              <th className="text-left font-normal py-2 pr-4 hidden sm:table-cell w-[96px]">evidence</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr
                key={r.id}
                onClick={() => onSelect(r.id)}
                onMouseEnter={() => onHover(r.id)}
                onMouseLeave={() => onHover(null)}
                className={`cursor-pointer border-t border-line/60 transition-colors duration-150 ${
                  selected === r.id ? "bg-origin-soft shadow-[inset_2px_0_0_var(--origin)]" : "hover:bg-white/[0.03]"
                }`}
              >
                <td className="pl-4 pr-1 py-2 num text-faint">{i + 1}</td>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {r.ticker ? (
                      <>
                        <span className="num font-medium text-text shrink-0">{r.ticker}</span>
                        <span className="text-muted truncate max-w-[130px]">{r.name}</span>
                      </>
                    ) : (
                      <span className="font-medium text-text truncate max-w-[170px]">{r.name}</span>
                    )}
                    {(holdings.has(r.id) || (r.ticker && holdings.has(r.ticker))) && (
                      <span title="In your portfolio" className="text-origin text-[10px]">●</span>
                    )}
                    {!r.in_universe && <span className="text-[10px] text-faint" title="Named in a filing; not in the curated universe">ext</span>}
                  </div>
                </td>
                <td className="py-2 px-1 num text-muted">{r.hop}</td>
                <td className="py-2 pr-2">
                  <ImpactBar v={r.impact} max={max} />
                </td>
                <td className="py-2 pr-4 hidden sm:table-cell">
                  <div className="flex items-center gap-2">
                    <QualityBadge q={r.quality} compact />
                    <CoverageDot c={r.coverage} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.length && (
          <p className="px-4 py-8 text-[13px] leading-6 text-muted">
            {filter === "mine"
              ? holdings.size
                ? "None of your holdings are on a known path from this event. That means no link we know of, not proof of no exposure."
                : "Add holdings on the Portfolio page to filter by them."
              : "No companies in this view."}
          </p>
        )}
      </div>
    </div>
  );
}
