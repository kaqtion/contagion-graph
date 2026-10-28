"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, post, type Health, type RunData, type RunSummary } from "@/lib/api";
import { EVENT_LABELS, timeAgo } from "@/lib/format";
import { loadHoldings } from "@/lib/holdings";
import ContagionGraph from "@/components/ContagionGraph";
import EventCard from "@/components/console/EventCard";
import ExposureTable from "@/components/console/ExposureTable";
import HeadlineBar from "@/components/console/HeadlineBar";
import PathDrawer from "@/components/console/PathDrawer";
import StageChips, { type StageKey, type StageState } from "@/components/console/StageChips";
import { Logo } from "@/components/Nav";
import { Panel, SectionTitle } from "@/components/ui";

const IDLE: Record<StageKey, StageState> = { parse: "idle", locate: "idle", trace: "idle", score: "idle", explain: "idle", critic: "idle" };

export default function Console({ runId }: { runId?: string }) {
  const [run, setRun] = useState<RunData | null>(null);
  const [stages, setStages] = useState(IDLE);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [explaining, setExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [needPasscode, setNeedPasscode] = useState<string | null>(null);
  const [passcode, setPasscode] = useState("");
  const [holdings, setHoldings] = useState<Set<string>>(new Set());
  const busy = stages.parse === "active";

  useEffect(() => setHoldings(new Set(loadHoldings().map((h) => h.ticker.toUpperCase()))), []);

  const explain = useCallback(async (r: RunData) => {
    if (r.explanation) {
      setStages((s) => ({ ...s, explain: "done", critic: "done" }));
      return;
    }
    if (!r.result.exposures.some((e) => !e.is_origin)) {
      setStages((s) => ({ ...s, explain: "skipped", critic: "skipped" }));
      return;
    }
    setExplaining(true);
    setExplainError(null);
    setStages((s) => ({ ...s, explain: "active", critic: "idle" }));
    try {
      const done = await post<RunData>(`/runs/${r.id}/explain`, {});
      setRun(done);
      setStages((s) => ({ ...s, explain: "done", critic: "done" }));
    } catch (e) {
      // 503 = no API key configured; 429 = budget/rate limit. Neither breaks the traced result.
      const soft = e instanceof ApiError && (e.status === 503 || e.status === 429);
      setExplainError(
        e instanceof ApiError && e.status === 503
          ? "Explanations are off because no AI key is configured. The paths and quotes below are complete."
          : e instanceof Error
            ? e.message
            : "Explanation failed",
      );
      setStages((s) => ({ ...s, explain: soft ? "skipped" : "error", critic: "skipped" }));
    } finally {
      setExplaining(false);
    }
  }, []);

  const show = useCallback(
    (r: RunData) => {
      setRun(r);
      setSelected(null);
      setStages({ ...IDLE, parse: "done", locate: "done", trace: "done", score: "done" });
      void explain(r);
    },
    [explain],
  );

  useEffect(() => {
    if (!runId) return;
    setStages({ ...IDLE, parse: "active" });
    api<RunData>(`/runs/${runId}`)
      .then(show)
      .catch((e) => {
        setError(e instanceof Error ? e.message : "Could not load this run");
        setStages(IDLE);
      });
  }, [runId, show]);

  const submit = async (headline: string, code?: string) => {
    setError(null);
    setNeedPasscode(null);
    setStages({ ...IDLE, parse: "active" });
    try {
      const r = await post<RunData>("/analyze", { headline, passcode: code ?? (passcode || undefined) });
      window.history.replaceState(null, "", `/run/${r.id}`);
      show(r);
    } catch (e) {
      setStages(IDLE);
      if (e instanceof ApiError && e.status === 401) setNeedPasscode(headline);
      else setError(e instanceof Error ? e.message : "Something went wrong");
    }
  };

  const nodes = useMemo(() => new Map((run?.result.graph.nodes ?? []).map((n) => [n.id, n])), [run]);
  const edges = useMemo(() => new Map((run?.result.graph.edges ?? []).map((e) => [e.id, e])), [run]);
  const selectedEx = run?.result.exposures.find((e) => e.id === selected) ?? null;
  const critic = run?.explanation?.critic;

  return (
    <div className="flex-1 lg:flex-none flex flex-col min-h-0 lg:h-[calc(100dvh_-_5.75rem)]">
      <div className="px-4 sm:px-6 pt-4 pb-3 space-y-3 border-b border-line">
        <HeadlineBar initial={run?.headline} busy={busy} onSubmit={(h) => submit(h)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StageChips
            state={stages}
            detail={{
              trace: run ? `${run.result.stats.paths}` : undefined,
              critic: critic ? `${critic.supported}/${critic.claims}` : undefined,
            }}
          />
          {run && <span className="text-[11px] text-faint num">run {run.id} · ${run.cost_usd.toFixed(4)} AI cost</span>}
        </div>
        {error && <p className="text-[13px] text-hurt">{error}</p>}
        {needPasscode && (
          <form
            className="flex flex-wrap items-center gap-2 text-[13px]"
            onSubmit={(e) => {
              e.preventDefault();
              void submit(needPasscode, passcode);
            }}
          >
            <span className="text-muted">New headlines need the demo passcode (examples are open to everyone):</span>
            <input
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className="bg-panel border border-line-strong rounded px-2 py-1 outline-none focus:border-origin/60"
              autoFocus
            />
            <button className="px-3 py-1 rounded bg-raise hover:bg-line-strong">Unlock</button>
          </form>
        )}
      </div>

      {run ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(380px,460px)_1fr] lg:grid-rows-[minmax(0,1fr)]">
          <div className="flex flex-col min-h-0 border-r border-line">
            <div className="border-b border-line">
              <SectionTitle>Event</SectionTitle>
              <EventCard run={run} />
            </div>
            <SectionTitle right={<span className="text-[11px] text-faint">ranked by |impact|</span>}>Exposure</SectionTitle>
            <div className="flex-1 min-h-[300px] lg:min-h-0 flex flex-col">
              <ExposureTable rows={run.result.exposures} selected={selected} onSelect={setSelected} onHover={setHovered} holdings={holdings} />
            </div>
          </div>

          <div className="relative min-h-[460px] lg:min-h-0 overflow-hidden">
            <ContagionGraph
              exposures={run.result.exposures}
              origins={run.result.origins}
              nodes={run.result.graph.nodes}
              edges={run.result.graph.edges}
              scores={run.result.all_scores}
              selected={selected}
              hovered={hovered}
              onSelect={setSelected}
            />
            <div className="absolute top-3 left-3 max-w-[min(460px,calc(100%-24px))] pointer-events-none">
              {run.explanation ? (
                <p className="pointer-events-auto text-[12.5px] leading-5 text-muted bg-bg/80 backdrop-blur border border-line rounded-md px-3 py-2 fade-up">
                  {run.explanation.summary}
                </p>
              ) : explaining ? (
                <div className="bg-bg/80 border border-line rounded-md px-3 py-2.5 w-[320px] space-y-1.5">
                  <div className="skeleton h-3" />
                  <div className="skeleton h-3 w-2/3" />
                </div>
              ) : null}
            </div>
            <Legend />
            {selectedEx && (
              <div className="fixed inset-0 z-40 lg:absolute lg:inset-y-0 lg:left-auto lg:right-0 lg:w-[440px] lg:z-20">
                <PathDrawer
                  ex={selectedEx}
                  nodes={nodes}
                  edges={edges}
                  explanation={run.explanation}
                  explaining={explaining}
                  explainError={explainError}
                  onClose={() => setSelected(null)}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <EmptyState loading={!!runId && !error} onPick={(h) => submit(h)} />
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-3 left-3 text-[11px] text-muted bg-bg/80 backdrop-blur border border-line rounded-md px-3 py-2 space-y-1 pointer-events-none">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-origin inline-block" />origin</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-hurt inline-block" />hurt</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-help inline-block" />helped</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#6b7484" strokeWidth="2" /></svg>quoted</span>
        <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#6b7484" strokeWidth="2" strokeDasharray="1 3" strokeLinecap="round" /></svg>curated</span>
        <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#6b7484" strokeWidth="2" strokeDasharray="5 3" /></svg>stale</span>
      </div>
      <div className="text-faint">size = |impact| · ring = hop</div>
    </div>
  );
}

function EmptyState({ loading, onPick }: { loading: boolean; onPick: (h: string) => void }) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [apiDown, setApiDown] = useState(false);
  useEffect(() => {
    api<RunSummary[]>("/runs").then(setRuns).catch(() => {
      setRuns([]);
      setApiDown(true);
    });
    api<Health>("/health").then(setHealth).catch(() => setApiDown(true));
  }, []);

  if (loading)
    return (
      <div className="flex-1 grid place-items-center">
        <div className="skeleton w-40 h-40 rounded-full" />
      </div>
    );

  const examples = (runs ?? []).filter((r) => r.is_demo);
  const recent = (runs ?? []).filter((r) => !r.is_demo).slice(0, 6);
  return (
    <div className="flex-1 px-4 sm:px-6 py-8 grid gap-8 lg:grid-cols-[1.1fr_1fr] max-w-6xl w-full mx-auto">
      <div className="space-y-6">
        <div className="space-y-3">
          <Logo size={40} />
          <h1 className="text-[28px] sm:text-[34px] leading-tight font-semibold tracking-tight">
            Which companies does this headline actually hit?
          </h1>
          <p className="text-muted text-[15px] leading-6 max-w-[56ch]">
            Contagion Graph traces a news event through supplier, customer, competitor, region and commodity links up to three
            hops out. It scores each company and shows the filing sentence behind every link. Vector search finds documents that
            mention the headline; this finds the consequences.
          </p>
        </div>
        {apiDown && (
          <p className="text-[13px] text-warn border border-warn/30 bg-warn/5 rounded-md px-3 py-2">
            The API isn’t reachable. Locally, start it with <code className="num">npm run dev:api</code>.
          </p>
        )}
        {health && (
          <dl className="grid grid-cols-3 gap-3 max-w-md">
            {[
              ["companies", health.graph.companies + health.graph.external_companies],
              ["links", health.graph.edges],
              ["filing quotes", health.graph.evidence_quotes],
            ].map(([k, v]) => (
              <div key={k} className="border border-line rounded-md px-3 py-2">
                <dd className="num text-[20px] font-semibold">{v}</dd>
                <dt className="text-[11px] text-faint">{k}</dt>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="space-y-5">
        <Panel>
          <SectionTitle>Worked examples · free to open</SectionTitle>
          <ul className="pb-2">
            {runs === null && [0, 1, 2].map((i) => <li key={i} className="mx-3 my-2 skeleton h-10" />)}
            {examples.map((r) => (
              <li key={r.id}>
                <Link href={`/run/${r.id}`} className="block px-3 py-2.5 hover:bg-panel-2 border-t border-line/60">
                  <span className="text-[13.5px] leading-5">{r.headline}</span>
                  <span className="block text-[11px] text-faint mt-0.5">
                    {EVENT_LABELS[r.event_type] ?? r.event_type} · severity {r.severity} · {r.reached} companies reached
                  </span>
                </Link>
              </li>
            ))}
            {runs !== null && !examples.length && (
              <li className="px-3 py-2 text-[12.5px] text-muted">
                No examples yet. Try{" "}
                <button className="text-help hover:underline" onClick={() => onPick("Earthquake halts TSMC fabs in Taiwan for several weeks")}>
                  an earthquake at TSMC
                </button>
                .
              </li>
            )}
          </ul>
        </Panel>
        {recent.length > 0 && (
          <Panel>
            <SectionTitle>Recently traced</SectionTitle>
            <ul className="pb-2">
              {recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/run/${r.id}`} className="flex justify-between gap-3 px-3 py-2 hover:bg-panel-2 border-t border-line/60 text-[13px]">
                    <span className="truncate">{r.headline}</span>
                    <span className="text-[11px] text-faint shrink-0">{timeAgo(r.created_at)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}
