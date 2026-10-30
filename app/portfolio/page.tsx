"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, post, type RunSummary } from "@/lib/api";
import { fmtImpact, impactColor } from "@/lib/format";
import { loadHoldings, saveHoldings, type HoldingRow } from "@/lib/holdings";
import { Badge, PageHeader, Panel, SectionTitle } from "@/components/ui";

type Row = {
  ticker: string;
  id?: string;
  weight: number;
  kind: "company" | "etf" | "unknown";
  name: string | null;
  impact: number | null;
  hop: number | null;
  status: "exposed" | "no_known_path" | "not_in_graph";
  coverage?: string | number;
  drivers?: { id: string; contribution: number }[];
};
type Result = { run_id: string; headline: string; rows: Row[]; weighted_impact: number; exposed: number; holdings: number; unknown_weight: number };

const SAMPLE: HoldingRow[] = [
  { ticker: "NVDA", weight: 15 },
  { ticker: "AAPL", weight: 15 },
  { ticker: "MSFT", weight: 12 },
  { ticker: "TM", weight: 10 },
  { ticker: "GM", weight: 8 },
  { ticker: "AMAT", weight: 10 },
  { ticker: "ALB", weight: 5 },
  { ticker: "TSLA", weight: 10 },
  { ticker: "JPM", weight: 15 },
];

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<HoldingRow[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string>("");
  const [result, setResult] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [quick, setQuick] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setHoldings(loadHoldings());
    setLoaded(true);
    api<RunSummary[]>("/runs?limit=50")
      .then((r) => {
        setRuns(r);
        if (r.length) setRunId(r[0].id);
      })
      .catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (loaded) saveHoldings(holdings);
  }, [holdings, loaded]);

  useEffect(() => {
    const valid = holdings.filter((h) => h.ticker.trim() && h.weight > 0);
    if (!runId || !valid.length) {
      setResult(null);
      return;
    }
    const t = setTimeout(() => {
      post<Result>("/portfolio/exposure", { run_id: runId, holdings: valid })
        .then((r) => {
          setResult(r);
          setErr(null);
        })
        .catch((e) => setErr(e.message));
    }, 250);
    return () => clearTimeout(t);
  }, [holdings, runId]);

  const total = holdings.reduce((s, h) => s + (h.weight || 0), 0);
  const addQuick = () => {
    // accepts "NVDA 20, AAPL 10" or one ticker per line
    const parts = quick.split(/[,\n;]+/).map((p) => p.trim()).filter(Boolean);
    const rows = parts.map((p) => {
      const [t, w] = p.split(/\s+/);
      return { ticker: t.toUpperCase(), weight: Number(w) || 10 };
    });
    setHoldings((h) => [...h, ...rows]);
    setQuick("");
  };

  const headline = useMemo(() => {
    if (!result) return null;
    const exposedRows = result.rows.filter((r) => r.status === "exposed");
    const hurt = exposedRows.filter((r) => (r.impact ?? 0) < 0).length;
    const helped = exposedRows.filter((r) => (r.impact ?? 0) > 0).length;
    return `${result.exposed} of your ${result.holdings} holdings sit on a known path from this event: ${hurt} hurt, ${helped} helped.`;
  }, [result]);

  return (
    <div className="max-w-[1320px] w-full mx-auto px-4 sm:px-8 py-8 sm:py-10 space-y-8">
      <PageHeader eyebrow="what it means for you" title="Portfolio lens." accent="Your book, through the graph.">
        Turns a market-wide exposure ranking into “what this means for you”. Exposure = Σ position weight × company impact. ETFs are split into
          their holdings first. Holdings stay in this browser.
      </PageHeader>

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <Panel>
          <SectionTitle right={<span className="num text-[11px] text-faint">total {total}</span>}>Holdings</SectionTitle>
          <div className="px-3 pb-3 space-y-2">
            {holdings.map((h, i) => (
              <div key={i} className="flex gap-2">
                <input
                  value={h.ticker}
                  onChange={(e) => setHoldings((hs) => hs.map((x, j) => (j === i ? { ...x, ticker: e.target.value.toUpperCase() } : x)))}
                  placeholder="Ticker"
                  className="num flex-1 min-w-0 bg-bg border border-line-strong rounded px-2 py-1.5 text-[13px] outline-none focus:border-origin/60"
                />
                <input
                  type="number"
                  min={0}
                  value={h.weight}
                  onChange={(e) => setHoldings((hs) => hs.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) } : x)))}
                  className="num w-20 bg-bg border border-line-strong rounded px-2 py-1.5 text-[13px] outline-none focus:border-origin/60"
                  aria-label="Weight"
                />
                <button onClick={() => setHoldings((hs) => hs.filter((_, j) => j !== i))} className="px-2 text-faint hover:text-hurt" aria-label="Remove">
                  ×
                </button>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <input
                value={quick}
                onChange={(e) => setQuick(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addQuick()}
                placeholder="Quick add: NVDA 20, SOXX 10"
                className="num flex-1 min-w-0 bg-bg border border-line rounded px-2 py-1.5 text-[13px] outline-none focus:border-origin/60"
              />
              <button onClick={addQuick} className="px-3 rounded bg-raise hover:bg-line-strong text-[13px]">Add</button>
            </div>
            <div className="flex gap-3 text-[12px] pt-1">
              <button onClick={() => setHoldings(SAMPLE)} className="text-help hover:underline">Load sample book</button>
              {holdings.length > 0 && (
                <button onClick={() => setHoldings([])} className="text-faint hover:text-hurt">Clear</button>
              )}
            </div>
          </div>
        </Panel>

        <div className="space-y-4 min-w-0">
          <Panel>
            <div className="px-3 py-3 flex flex-col sm:flex-row sm:items-center gap-2">
              <label htmlFor="run" className="text-[12px] text-faint shrink-0">Event</label>
              <select
                id="run"
                value={runId}
                onChange={(e) => setRunId(e.target.value)}
                className="flex-1 min-w-0 bg-bg border border-line-strong rounded px-2 py-1.5 text-[13px] outline-none"
              >
                {runs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.is_demo ? "★ " : ""}
                    {r.headline}
                  </option>
                ))}
              </select>
              {runId && (
                <Link href={`/run/${runId}`} className="text-[12px] text-help hover:underline shrink-0">open trace →</Link>
              )}
            </div>
          </Panel>

          {err && <p className="text-hurt text-[13px]">{err}</p>}
          {!holdings.length && (
            <Panel className="px-4 py-8 text-center text-muted text-[14px]">Add holdings or load the sample book to see your exposure.</Panel>
          )}

          {result && (
            <>
              <p className="text-[16px] leading-6">{headline}</p>
              <div className="grid grid-cols-3 gap-3">
                <Kpi label="weighted exposure" value={fmtImpact(result.weighted_impact)} color={impactColor(result.weighted_impact)} />
                <Kpi label="holdings exposed" value={`${result.exposed}/${result.holdings}`} />
                <Kpi label="weight not in graph" value={`${Math.round(result.unknown_weight * 100)}%`} hint="Unknown, not zero" />
              </div>
              <Panel className="overflow-x-auto">
                <table className="w-full text-[13px] min-w-[560px]">
                  <thead>
                    <tr className="text-faint text-[11px] num">
                      <th className="text-left font-medium px-3 py-2">Holding</th>
                      <th className="text-right font-medium py-2">Weight</th>
                      <th className="text-left font-medium py-2 pl-4">Status</th>
                      <th className="text-right font-medium py-2">Hop</th>
                      <th className="text-right font-medium py-2">Impact</th>
                      <th className="text-right font-medium py-2 pr-3">Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((r) => (
                      <tr key={r.ticker} className="border-t border-line/60">
                        <td className="px-3 py-2">
                          {r.id ? (
                            <Link href={`/explorer/${encodeURIComponent(r.id)}`} className="num font-medium hover:text-help">{r.ticker}</Link>
                          ) : (
                            <span className="num font-medium">{r.ticker}</span>
                          )}
                          <span className="text-muted ml-2">{r.name ?? ""}</span>
                          {r.kind === "etf" && r.drivers?.length ? (
                            <span className="block text-[11px] text-faint">
                              via {r.drivers.map((d) => d.id).join(", ")} · {Math.round(Number(r.coverage) * 100)}% of fund in graph
                            </span>
                          ) : null}
                        </td>
                        <td className="text-right num text-muted">{(r.weight * 100).toFixed(1)}%</td>
                        <td className="pl-4">
                          {r.status === "exposed" ? (
                            <Badge tone={(r.impact ?? 0) < 0 ? "hurt" : "help"}>{(r.impact ?? 0) < 0 ? "hurt" : "helped"}</Badge>
                          ) : r.status === "no_known_path" ? (
                            <Badge>no known path</Badge>
                          ) : (
                            <Badge tone="warn">not in graph</Badge>
                          )}
                        </td>
                        <td className="text-right num text-muted">{r.hop ?? "–"}</td>
                        <td className="text-right num" style={{ color: impactColor(r.impact) }}>{fmtImpact(r.impact)}</td>
                        <td className="text-right num pr-3" style={{ color: impactColor(r.impact) }}>
                          {r.impact == null ? "–" : fmtImpact(r.impact * r.weight)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <p className="text-[12px] text-faint">
                “No known path” means the graph has no link from this event to the company, which is not proof of no exposure. Check the company’s coverage
                in the explorer.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div className="border border-line rounded-lg bg-panel px-3 py-2.5" title={hint}>
      <div className="num text-[20px] font-semibold" style={{ color }}>{value}</div>
      <div className="text-[11px] text-faint">{label}</div>
    </div>
  );
}
