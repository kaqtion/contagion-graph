"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Panel, SectionTitle } from "@/components/ui";

type Method = { method: string; n: number; mean_car: number | null; hit_rate: number | null };
type Point = { ticker: string; name: string; impact: number; car1: number | null; car5: number | null; car10: number | null };
type BT = {
  key: string;
  date: string;
  headline: string;
  origins: string[];
  methods: Method[];
  spearman_reached: number | null;
  n_reached: number;
  points: Point[];
};

const HURT = "#e85a38";
const HELP = "#3a88ee";
const NEUTRAL = "#4a5361";
const pct = (v: number | null | undefined, d = 1) => (v == null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(d)}%`);

export default function BacktestPage() {
  const [data, setData] = useState<BT[] | null>(null);
  const [active, setActive] = useState(0);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    api<BT[]>("/backtests").then(setData).catch(() => setData([]));
  }, []);

  const bt = data?.[active];
  const overall = useMemo(() => {
    if (!data?.length) return [];
    const by = new Map<string, { hits: number[]; cars: number[] }>();
    data.forEach((d) =>
      d.methods.forEach((m) => {
        const e = by.get(m.method) ?? { hits: [], cars: [] };
        if (m.hit_rate != null) e.hits.push(m.hit_rate);
        if (m.mean_car != null) e.cars.push(m.mean_car);
        by.set(m.method, e);
      }),
    );
    return [...by.entries()].map(([method, v]) => ({
      method,
      hit: v.hits.reduce((a, b) => a + b, 0) / (v.hits.length || 1),
      car: v.cars.reduce((a, b) => a + b, 0) / (v.cars.length || 1),
      events: v.hits.length,
    }));
  }, [data]);

  return (
    <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
      <header className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Backtest</h1>
        <p className="text-muted text-[14px] max-w-[75ch]">
          Do the companies the graph flags actually fall? For each historical shock we compare predicted exposure with 5-day market-adjusted returns
          (stock minus SPY, from the close before day 0), against simpler baselines.
        </p>
      </header>

      {data === null && <div className="skeleton h-64" />}
      {data?.length === 0 && <Panel className="p-4 text-muted text-[14px]">No backtests yet. Run <code className="num">python -m scripts.backtest</code>.</Panel>}

      {data && data.length > 0 && (
        <>
          <Panel>
            <SectionTitle>Across {data.length} events · hit rate = share of flagged companies that underperformed SPY over 5 days</SectionTitle>
            <div className="px-3 pb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {overall.map((o) => (
                <div key={o.method} className={`rounded-md border px-3 py-2 ${o.method === "Contagion graph" ? "border-origin/40 bg-origin-soft" : "border-line"}`}>
                  <div className="text-[12px] text-muted">{o.method}</div>
                  <div className="num text-[20px] font-semibold">{Math.round(o.hit * 100)}%</div>
                  <div className="num text-[11px] text-faint">avg CAR5 {pct(o.car, 2)} · {o.events} events</div>
                </div>
              ))}
            </div>
          </Panel>

          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
            {data.map((d, i) => (
              <button
                key={d.key}
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`shrink-0 text-left rounded-lg border px-3 py-2 max-w-[260px] transition-colors ${i === active ? "border-origin/50 bg-panel-2" : "border-line hover:border-line-strong"}`}
              >
                <div className="num text-[11px] text-faint">{d.date}</div>
                <div className="text-[12.5px] leading-[17px] line-clamp-2">{d.headline}</div>
              </button>
            ))}
          </div>

          {bt && (
            <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
              <Panel>
                <SectionTitle
                  right={
                    <button onClick={() => setShowTable((s) => !s)} className="text-[12px] text-help hover:underline">
                      {showTable ? "show chart" : "show table"}
                    </button>
                  }
                >
                  Predicted impact vs 5-day abnormal return
                </SectionTitle>
                {showTable ? <PointsTable points={bt.points} /> : <Scatter points={bt.points} />}
                <p className="px-3 pb-3 text-[12px] text-faint">
                  Good predictions sit bottom-left (predicted hurt, fell) or top-right (predicted helped, rose). Spearman over {bt.n_reached} reached
                  companies: <span className="num text-muted">{bt.spearman_reached ?? "n/a (too few)"}</span>
                  {bt.spearman_reached != null && " (positive = scores line up with moves)"}.
                </p>
              </Panel>
              <Panel>
                <SectionTitle>Mean CAR5 of each method’s “hurt” list</SectionTitle>
                <MethodBars methods={bt.methods} />
                <div className="px-3 pb-3 text-[12px] text-faint space-y-1">
                  <p>Origin: {bt.origins.join(", ") || "region only"}. More negative is better for a negative shock.</p>
                  <p>Same-sector peers = every company in the origin’s sector. Whole universe = the market-wide drift of our chip and auto names that week.</p>
                </div>
              </Panel>
            </div>
          )}

          <p className="text-[12px] text-faint border-t border-line pt-3">
            Caveat: the graph is built from recent filings, so applying it to 2011–2024 events has look-ahead bias, and companies listed later are missing.
            This tests whether the propagation logic points at the right names, not what a strategy would have earned.
          </p>
        </>
      )}
    </div>
  );
}

function MethodBars({ methods }: { methods: Method[] }) {
  const max = Math.max(0.01, ...methods.map((m) => Math.abs(m.mean_car ?? 0)));
  return (
    <ul className="px-3 pb-3 space-y-3">
      {methods.map((m) => {
        const v = m.mean_car ?? 0;
        const w = (Math.abs(v) / max) * 50;
        const ours = m.method === "Contagion graph";
        return (
          <li key={m.method}>
            <div className="flex justify-between text-[12.5px]">
              <span className={ours ? "text-text font-medium" : "text-muted"}>{m.method}</span>
              <span className="num text-muted">
                {pct(m.mean_car, 2)} · hit {m.hit_rate == null ? "–" : `${Math.round(m.hit_rate * 100)}%`} · n {m.n}
              </span>
            </div>
            <div className="relative h-3 mt-1" title={`${m.method}: mean CAR5 ${pct(m.mean_car, 2)}`}>
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-line-strong" />
              <div
                className="absolute top-[2px] h-2"
                style={{
                  background: ours ? "#f2b544" : NEUTRAL,
                  width: `${w}%`,
                  left: v < 0 ? `${50 - w}%` : "50%",
                  borderRadius: v < 0 ? "4px 0 0 4px" : "0 4px 4px 0",
                }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Scatter({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<Point | null>(null);
  const W = 640;
  const H = 380;
  const m = { l: 52, r: 16, t: 14, b: 40 };
  const pts = points.filter((p) => p.car5 != null);
  const xMax = Math.max(0.1, ...pts.map((p) => Math.abs(p.impact))) * 1.1;
  const yMax = Math.max(0.03, ...pts.map((p) => Math.abs(p.car5!))) * 1.1;
  const x = (v: number) => m.l + ((v + xMax) / (2 * xMax)) * (W - m.l - m.r);
  const y = (v: number) => m.t + ((yMax - v) / (2 * yMax)) * (H - m.t - m.b);
  const yTicks = niceTicks(yMax);
  const xTicks = niceTicks(xMax);
  const labelled = new Set([...pts].filter((p) => p.impact !== 0).sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact)).slice(0, 5).map((p) => p.ticker));
  // draw unreached companies first so reached ones sit on top
  const ordered = [...pts].sort((a, b) => Math.abs(a.impact) - Math.abs(b.impact));

  return (
    <div className="relative px-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Scatter of predicted impact against 5-day abnormal return">
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "#3a4250" : "#1a1f27"} strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="#5d6676" fontFamily="JetBrains Mono, monospace">
              {pct(t, 0)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line x1={x(t)} x2={x(t)} y1={m.t} y2={H - m.b} stroke={t === 0 ? "#3a4250" : "#1a1f27"} strokeWidth={1} />
            <text x={x(t)} y={H - m.b + 15} textAnchor="middle" fontSize={10.5} fill="#5d6676" fontFamily="JetBrains Mono, monospace">
              {t.toFixed(2)}
            </text>
          </g>
        ))}
        <text x={(m.l + W - m.r) / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="#8b94a5">
          predicted impact (← hurt · helped →)
        </text>
        <text transform={`translate(13 ${(m.t + H - m.b) / 2}) rotate(-90)`} textAnchor="middle" fontSize={11} fill="#8b94a5">
          5-day abnormal return
        </text>
        {ordered.map((p) => {
          const c = p.impact < 0 ? HURT : p.impact > 0 ? HELP : NEUTRAL;
          const cx = x(p.impact);
          const cy = y(p.car5!);
          return (
            <g key={p.ticker} onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} style={{ cursor: "default" }}>
              <circle cx={cx} cy={cy} r={11} fill="transparent" />
              <circle cx={cx} cy={cy} r={p.impact === 0 ? 3.5 : 5} fill={c} stroke="#0f1217" strokeWidth={2} opacity={p.impact === 0 ? 0.55 : 1} />
              {labelled.has(p.ticker) && (
                <text x={cx + 8} y={cy + 3.5} fontSize={10.5} fill="#c9ced8" fontFamily="JetBrains Mono, monospace">
                  {p.ticker}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          className="absolute pointer-events-none bg-raise border border-line-strong rounded-md px-2.5 py-1.5 text-[12px] shadow-xl"
          style={{ left: `${(x(hover.impact) / W) * 100}%`, top: `${(y(hover.car5!) / H) * 100}%`, transform: "translate(12px, -110%)" }}
        >
          <div className="font-medium">
            <span className="num">{hover.ticker}</span> <span className="text-muted">{hover.name}</span>
          </div>
          <div className="num text-muted">impact {hover.impact.toFixed(3)} · CAR5 {pct(hover.car5, 2)}</div>
        </div>
      )}
      <div className="flex gap-4 px-3 pb-1 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: HURT }} />predicted hurt</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: HELP }} />predicted helped</span>
        <span className="flex items-center gap-1.5"><i className="w-2 h-2 rounded-full inline-block opacity-60" style={{ background: NEUTRAL }} />not reached</span>
      </div>
    </div>
  );
}

function niceTicks(max: number): number[] {
  const step = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1].find((s) => max / s <= 3) ?? 1;
  const out = [];
  for (let v = -Math.floor(max / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

function PointsTable({ points }: { points: Point[] }) {
  const rows = [...points].sort((a, b) => a.impact - b.impact);
  return (
    <div className="max-h-[400px] overflow-auto">
      <table className="w-full text-[12.5px]">
        <thead className="sticky top-0 bg-panel">
          <tr className="text-faint text-[10.5px] uppercase tracking-wider">
            <th className="text-left font-medium px-3 py-1.5">Ticker</th>
            <th className="text-right font-medium py-1.5">Impact</th>
            <th className="text-right font-medium py-1.5">CAR1</th>
            <th className="text-right font-medium py-1.5">CAR5</th>
            <th className="text-right font-medium py-1.5 pr-3">CAR10</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.ticker} className="border-t border-line/60">
              <td className="px-3 py-1"><span className="num">{p.ticker}</span> <span className="text-muted">{p.name}</span></td>
              <td className="text-right num">{p.impact.toFixed(3)}</td>
              <td className="text-right num text-muted">{pct(p.car1, 2)}</td>
              <td className="text-right num text-muted">{pct(p.car5, 2)}</td>
              <td className="text-right num text-muted pr-3">{pct(p.car10, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
