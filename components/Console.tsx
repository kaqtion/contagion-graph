"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError, post, type RunData } from "@/lib/api";
import { loadHoldings } from "@/lib/holdings";
import ContagionGraph from "@/components/ContagionGraph";
import EventCard from "@/components/console/EventCard";
import ExposureTable from "@/components/console/ExposureTable";
import HeadlineBar from "@/components/console/HeadlineBar";
import Landing from "@/components/console/Landing";
import PathDrawer from "@/components/console/PathDrawer";
import StageChips, { type StageKey, type StageState } from "@/components/console/StageChips";
import { SectionTitle } from "@/components/ui";

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

  const notices = (
    <>
      {error && (
        <p role="alert" className="text-[13px] text-hurt border border-hurt/30 bg-hurt-soft rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {needPasscode && (
        <form
          className="flex flex-wrap items-center gap-2 text-[13px]"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(needPasscode, passcode);
          }}
        >
          <span className="text-muted">New headlines need the demo passcode. Worked examples are open to everyone.</span>
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            aria-label="Demo passcode"
            className="bg-panel border border-line-strong rounded-lg px-2.5 py-1.5 outline-none focus:border-origin/60"
            autoFocus
          />
          <button className="btn-quiet px-3 py-1.5">Unlock</button>
        </form>
      )}
    </>
  );

  if (!run && !runId) {
    if (busy)
      return (
        <div className="flex-1 grid place-items-center px-4">
          <div className="w-full max-w-xl space-y-6 text-center fade-up">
            <p className="eyebrow">tracing</p>
            <p className="display text-[34px] sm:text-[44px]">Following the shock through the graph…</p>
            <div className="flex justify-center">
              <StageChips state={stages} />
            </div>
          </div>
        </div>
      );
    return <Landing busy={busy} onSubmit={(h) => submit(h)} header={notices} />;
  }

  return (
    <div className="flex-1 lg:flex-none flex flex-col min-h-0 lg:h-[calc(100dvh_-_6rem)]">
      <div className="px-4 sm:px-6 pt-3.5 pb-3 space-y-3 border-b border-line bg-panel/30">
        <HeadlineBar initial={run?.headline} busy={busy} onSubmit={(h) => submit(h)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StageChips
            state={stages}
            detail={{
              trace: run ? `${run.result.stats.paths}` : undefined,
              critic: critic ? `${critic.supported}/${critic.claims}` : undefined,
            }}
          />
          {run && (
            <span className="text-[11px] text-faint num">
              run {run.id} · ${run.cost_usd.toFixed(4)} AI cost
            </span>
          )}
        </div>
        {notices}
      </div>

      {run ? (
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(380px,460px)_1fr] lg:grid-rows-[minmax(0,1fr)]">
          <div className="flex flex-col min-h-0 border-r border-line bg-panel/40">
            <div className="border-b border-line">
              <SectionTitle>event</SectionTitle>
              <EventCard run={run} />
            </div>
            <SectionTitle right={<span className="text-[11px] text-faint num">ranked by |impact|</span>}>exposure</SectionTitle>
            <div className="flex-1 min-h-[300px] lg:min-h-0 flex flex-col">
              <ExposureTable rows={run.result.exposures} selected={selected} onSelect={setSelected} onHover={setHovered} holdings={holdings} />
            </div>
          </div>

          <div className="relative min-h-[460px] lg:min-h-0 overflow-hidden">
            <div className="absolute inset-0 dot-grid pointer-events-none [mask-image:radial-gradient(circle_at_50%_50%,black_20%,transparent_75%)]" aria-hidden />
            <div
              className="absolute inset-0 pointer-events-none"
              style={{ background: "radial-gradient(circle at 50% 50%, rgba(242,181,68,0.07), transparent 45%)" }}
              aria-hidden
            />
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
            <div className="absolute top-4 left-4 max-w-[min(480px,calc(100%-32px))] pointer-events-none">
              {run.explanation ? (
                <div
                  onClick={(e) => e.currentTarget.querySelector("p")?.classList.toggle("line-clamp-3")}
                  title="Click to expand or collapse"
                  className="glass rounded-xl px-4 py-3 cursor-pointer pointer-events-auto fade-up"
                >
                  <p className="eyebrow mb-1.5">the short version</p>
                  <p className="line-clamp-3 text-[13px] leading-[1.6] text-text/85">{run.explanation.summary}</p>
                </div>
              ) : explaining ? (
                <div className="glass rounded-xl px-4 py-3 w-[340px] space-y-2">
                  <p className="eyebrow">writing the explanation</p>
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
        <div className="flex-1 grid place-items-center px-4 py-16">
          {error ? (
            <div className="text-center space-y-4">
              <p className="display text-[34px]">This trace couldn’t be loaded.</p>
              <Link href="/" className="btn-quiet px-4 py-2 text-[13px]">
                ← Back to the console
              </Link>
            </div>
          ) : (
            <div className="relative w-44 h-44" aria-label="Loading trace">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className="absolute inset-0 rounded-full border border-origin/40"
                  style={{ animation: `pulse-ring 2.4s ${i * 0.8}s ease-out infinite` }}
                />
              ))}
              <span className="absolute inset-[42%] rounded-full bg-origin" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="absolute bottom-4 left-4 text-[11px] text-muted glass rounded-xl px-3.5 py-2.5 space-y-1.5 pointer-events-none">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-origin inline-block" />origin</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-hurt inline-block" />hurt</span>
        <span className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-full bg-help inline-block" />helped</span>
      </div>
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#7d828b" strokeWidth="2" /></svg>quoted</span>
        <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#7d828b" strokeWidth="2" strokeDasharray="1 3" strokeLinecap="round" /></svg>curated</span>
        <span className="flex items-center gap-1.5"><svg width="18" height="4"><line x1="0" y1="2" x2="18" y2="2" stroke="#7d828b" strokeWidth="2" strokeDasharray="5 3" /></svg>stale</span>
      </div>
      <div className="text-faint">size = |impact| · ring = hop</div>
    </div>
  );
}
