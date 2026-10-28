"use client";

import Link from "next/link";
import { useState } from "react";
import type { EdgeInfo, Explanation, Exposure, NodeInfo, ScoredPath } from "@/lib/api";
import { fmtImpact, impactColor, relPhrase, SECTOR_LABELS, strengthText } from "@/lib/format";
import { Badge, CoverageDot, QualityBadge } from "@/components/ui";

type Props = {
  ex: Exposure;
  nodes: Map<string, NodeInfo>;
  edges: Map<number, EdgeInfo>;
  explanation: Explanation | null;
  explaining: boolean;
  explainError: string | null;
  onClose: () => void;
};

const KIND_LABEL: Record<string, string> = {
  down: "supplies",
  up: "buys from",
  competitor: "competes",
  located_in: "located in",
  uses: "used by",
  produces: "produced by",
};

export default function PathDrawer({ ex, nodes, edges, explanation, explaining, explainError, onClose }: Props) {
  const name = (id: string) => nodes.get(id)?.name ?? id;
  const expl = explanation?.companies.find((c) => c.id === ex.id);

  return (
    <div className="h-full flex flex-col bg-panel border-l border-line fade-up">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3 border-b border-line">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="num text-[18px] font-semibold">{ex.ticker ?? ex.name}</span>
            <CoverageDot c={ex.coverage} />
          </div>
          <div className="text-[12.5px] text-muted truncate">
            {ex.name}
            {ex.sector ? ` · ${SECTOR_LABELS[ex.sector] ?? ex.sector}` : ""}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="num text-[22px] leading-6 font-semibold" style={{ color: impactColor(ex.impact) }}>
            {fmtImpact(ex.impact)}
          </div>
          <div className="text-[11px] text-faint">
            {ex.impact < 0 ? "hurt" : "helped"} · hop {ex.hop} · {ex.path_count} path{ex.path_count === 1 ? "" : "s"}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" className="text-faint hover:text-text -mr-1 -mt-1 px-1 text-lg leading-none">
          ×
        </button>
      </div>

      <div className="overflow-y-auto flex-1 px-4 py-3 space-y-5">
        <section>
          <h3 className="text-[11px] uppercase tracking-[0.08em] text-faint mb-2">Why</h3>
          {expl ? (
            <div className="space-y-2">
              <p className="text-[13px] leading-5">{expl.rationale}</p>
              <ul className="space-y-1.5">
                {expl.claims.map((c, i) => (
                  <li key={i} className="flex gap-2 text-[12px] leading-[18px]">
                    <span className={c.supported === false ? "text-warn" : "text-ok"} title={c.supported === false ? c.issue : "Supported by cited quote"}>
                      {c.supported === false ? "⚠" : "✓"}
                    </span>
                    <span className="text-muted">
                      {c.text}
                      {c.evidence_ids.map((id) => (
                        <a key={id} href={`#ev-${id}`} className="num ml-1 text-[10.5px] text-help hover:underline">
                          [E{id}]
                        </a>
                      ))}
                      {c.supported === false && c.issue && <span className="block text-warn/90">Critic: {c.issue}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : explaining ? (
            <div className="space-y-2">
              <div className="skeleton h-3.5 w-full" />
              <div className="skeleton h-3.5 w-4/5" />
              <div className="skeleton h-3.5 w-3/5" />
            </div>
          ) : (
            <p className="text-[12.5px] text-muted">
              {explainError ?? "Not in the explained top 10. The paths below show the full evidence."}
            </p>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-[11px] uppercase tracking-[0.08em] text-faint">Paths</h3>
          {ex.paths.length === 0 && <p className="text-[12.5px] text-muted">This is the event origin.</p>}
          {ex.paths.map((p, i) => (
            <PathCard key={i} index={i} p={p} edges={edges} name={name} />
          ))}
          {ex.path_count > ex.paths.length && (
            <p className="text-[11.5px] text-faint">+ {ex.path_count - ex.paths.length} weaker paths included in the score</p>
          )}
        </section>

        {nodes.get(ex.id)?.kind === "company" && (
          <Link href={`/explorer/${encodeURIComponent(ex.id)}`} className="inline-block text-[12px] text-help hover:underline">
            Open {ex.ticker ?? ex.name} in the explorer →
          </Link>
        )}
      </div>
    </div>
  );
}

function PathCard({ p, index, edges, name }: { p: ScoredPath; index: number; edges: Map<number, EdgeInfo>; name: (id: string) => string }) {
  const [math, setMath] = useState(false);
  return (
    <div className="border border-line rounded-md bg-panel-2/60">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-line/70">
        <span className="text-[12px] text-muted">
          Path {index + 1} · <span className="num" style={{ color: impactColor(p.contribution) }}>{fmtImpact(p.contribution)}</span>
        </span>
        <div className="flex items-center gap-2">
          <QualityBadge q={p.quality} reasons={p.quality_reasons} />
          <button onClick={() => setMath((m) => !m)} className="text-[11px] text-faint hover:text-text">
            {math ? "hide math" : "math"}
          </button>
        </div>
      </div>
      <div className="px-3 py-2 flex flex-wrap items-center gap-1 text-[12px]">
        {p.nodes.map((n, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-faint text-[10.5px]">— {KIND_LABEL[p.steps[i - 1].kind] ?? p.steps[i - 1].kind} →</span>}
            <span className={`rounded px-1.5 py-px ${i === 0 ? "bg-origin-soft text-origin" : "bg-raise"}`}>{name(n)}</span>
          </span>
        ))}
      </div>
      {math && (
        <div className="mx-3 mb-2 num text-[11px] text-muted bg-bg/60 rounded px-2 py-1.5 leading-5 overflow-x-auto whitespace-nowrap">
          {p.math.severity} × ({p.math.polarity > 0 ? "+1" : "−1"})
          {p.math.terms.map((t, i) => (
            <span key={i}> × ({t.w}·{t.s > 0 ? "+1" : "−1"})</span>
          ))}{" "}
          × λ {p.math.decay} × fresh {p.math.freshness} = <span style={{ color: impactColor(p.contribution) }}>{fmtImpact(p.contribution)}</span>
        </div>
      )}
      <ul className="px-3 pb-3 space-y-2.5">
        {p.steps.map((s) => {
          const e = edges.get(s.edge_id);
          if (!e) return null;
          return (
            <li key={s.edge_id} className="text-[12px]">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-text">{relPhrase(e, name)}</span>
                <Badge>{strengthText(e)}</Badge>
                {e.quality === "speculative" && <Badge tone="warn" title={e.quality_reasons.join("\n")}>{e.quality_reasons[0]}</Badge>}
              </div>
              {e.evidence?.length ? (
                e.evidence.slice(0, 2).map((q) => (
                  <blockquote id={`ev-${q.id}`} key={q.id} className="mt-1.5 border-l-2 border-line-strong pl-2.5 text-muted leading-[18px] scroll-mt-24">
                    “{q.quote}”
                    <span className="block mt-0.5 text-[11px] text-faint">
                      <span className="num">[E{q.id}]</span> {q.source}
                      {q.url && (
                        <a href={q.url} target="_blank" rel="noreferrer" className="ml-1.5 text-help hover:underline">
                          filing ↗
                        </a>
                      )}
                    </span>
                  </blockquote>
                ))
              ) : (
                <p className="mt-1 text-[11.5px] text-faint italic">{e.note ?? "No source quote."}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
