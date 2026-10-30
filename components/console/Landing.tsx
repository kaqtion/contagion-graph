"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api, type Health, type RunSummary } from "@/lib/api";
import { EVENT_LABELS, timeAgo } from "@/lib/format";
import BlastRadius from "@/components/BlastRadius";
import HeadlineBar from "@/components/console/HeadlineBar";

const STEPS = [
  ["Parse", "An AI model reads the headline: what kind of shock, how severe, how long, and who or where it hits."],
  ["Locate", "The origin is matched to a node in the graph: a company, a region like Taiwan, or a commodity like lithium."],
  ["Trace", "Exposure flows one to three hops along supplier, customer, competitor, region and commodity links, halving each hop."],
  ["Explain", "Every path is explained from the filing sentences behind its links, then a critic checks each claim against its quote."],
] as const;

export default function Landing({ busy, onSubmit, header }: { busy: boolean; onSubmit: (h: string) => void; header?: React.ReactNode }) {
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

  const examples = (runs ?? []).filter((r) => r.is_demo);
  const recent = (runs ?? []).filter((r) => !r.is_demo).slice(0, 5);

  return (
    <div className="flex-1">
      {/* hero */}
      <section className="relative overflow-hidden border-b border-line">
        <div className="absolute inset-0 dot-grid [mask-image:radial-gradient(ellipse_at_70%_45%,black_10%,transparent_65%)]" aria-hidden />
        <div className="relative max-w-[1320px] mx-auto px-4 sm:px-8 grid lg:grid-cols-[1.08fr_0.92fr] items-center gap-6 min-h-[calc(100dvh_-_6rem)] py-10 lg:py-0">
          <div className="stagger space-y-7 lg:pr-4 min-w-0">
            <p className="eyebrow">supply-chain contagion, traced from SEC filings</p>
            <h1 className="display text-[54px] sm:text-[80px] xl:text-[96px] text-text">
              Every headline has a <em className="text-origin">blast radius.</em>
            </h1>
            <p className="text-muted text-[16px] sm:text-[17px] leading-[1.65] max-w-[50ch]">
              Paste a news event. See which companies get hurt or helped, through which supplier, customer and competitor
              links, with the filing sentence that proves every one.
            </p>
            <div className="max-w-[620px] space-y-3">
              <HeadlineBar hero busy={busy} onSubmit={onSubmit} />
              {header}
              {apiDown && (
                <p className="text-[13px] text-warn border border-warn/30 bg-warn/5 rounded-lg px-3 py-2">
                  The API isn’t reachable. Locally, start it with <code className="num">npm run dev:api</code>.
                </p>
              )}
            </div>
            <dl className="flex flex-wrap gap-x-10 gap-y-4 pt-2">
              {(
                [
                  ["companies mapped", health ? health.graph.companies + health.graph.external_companies : null],
                  ["supply-chain links", health?.graph.edges ?? null],
                  ["verbatim filing quotes", health?.graph.evidence_quotes ?? null],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="space-y-1">
                  <dd className="num text-[26px] sm:text-[30px] font-medium tracking-tight text-text">
                    {v === null ? <span className="skeleton inline-block w-16 h-7 align-middle" /> : v.toLocaleString()}
                  </dd>
                  <dt className="text-[12px] text-faint">{k}</dt>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative mx-auto w-full max-w-[340px] sm:max-w-[460px] lg:max-w-[600px]">
            <BlastRadius className="w-full h-auto" />
            <div className="hidden sm:block glass absolute right-0 bottom-[8%] rounded-xl px-4 py-3 fade-up" style={{ animationDelay: "1.6s" }}>
              <p className="eyebrow mb-1">example trace</p>
              <p className="text-[13px] text-text">Earthquake halts TSMC fabs</p>
              <p className="num text-[11.5px] text-muted mt-0.5">
                <span className="text-hurt">54 hurt</span> · <span className="text-help">4 helped</span> · 3 hops
              </p>
            </div>
          </div>
        </div>
        <a href="#examples" className="hidden lg:flex absolute left-1/2 -translate-x-1/2 bottom-5 items-center gap-2 text-[11.5px] text-faint hover:text-muted transition-colors num">
          scroll for worked examples
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className="animate-bounce">
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </a>
      </section>

      {/* worked examples */}
      <section id="examples" className="max-w-[1320px] mx-auto px-4 sm:px-8 py-20 sm:py-28 grid lg:grid-cols-[0.8fr_1.6fr] gap-10 lg:gap-16 scroll-mt-16">
        <div className="lg:sticky lg:top-24 self-start space-y-4">
          <p className="eyebrow">worked examples</p>
          <h2 className="display text-[40px] sm:text-[52px]">
            Real shocks, <em className="text-muted">already traced.</em>
          </h2>
          <p className="text-muted text-[15px] leading-7 max-w-[38ch]">
            Each one is stored with its full ranking, paths, explanations and critic verdicts. Opening one costs nothing.
          </p>
        </div>
        <ol className="border-t border-line min-w-0">
          {runs === null && [0, 1, 2, 3].map((i) => <li key={i} className="skeleton h-20 my-3" />)}
          {examples.map((r, i) => (
            <li key={r.id}>
              <Link
                href={`/run/${r.id}`}
                className="group grid grid-cols-[2.25rem_1fr_auto] sm:grid-cols-[3.5rem_1fr_auto] items-center gap-x-4 py-6 border-b border-line transition-colors hover:bg-white/[0.02] -mx-3 px-3 rounded-lg"
              >
                <span className="num text-[12px] text-faint self-start pt-1.5">{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 space-y-2.5">
                  <span className="block text-[18px] sm:text-[22px] leading-snug tracking-tight text-text/90 group-hover:text-text transition-colors">
                    {r.headline}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted">
                    <span className="inline-flex items-center gap-1.5">
                      <i className="w-1.5 h-1.5 rounded-full bg-hurt" />
                      {EVENT_LABELS[r.event_type] ?? r.event_type}
                    </span>
                    <span className="inline-flex items-center gap-1.5" title={`Severity ${r.severity} of 5`}>
                      <span className="flex gap-[3px]">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <i key={s} className={`w-[3px] h-2.5 rounded-full ${s <= r.severity ? "bg-hurt" : "bg-line-strong"}`} />
                        ))}
                      </span>
                      severity {r.severity}
                    </span>
                    <span className="num">{r.reached} companies reached</span>
                  </span>
                </span>
                <span className="w-10 h-10 rounded-full border border-line-strong grid place-items-center text-muted transition-all duration-300 group-hover:bg-origin group-hover:border-origin group-hover:text-[#17120a] group-hover:-rotate-45">
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
                    <path d="M2 7h9.5M7.5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </Link>
            </li>
          ))}
          {runs !== null && !examples.length && (
            <li className="py-6 text-[14px] text-muted">
              No examples yet. Try{" "}
              <button className="text-origin hover:underline" onClick={() => onSubmit("Earthquake halts TSMC fabs in Taiwan for several weeks")}>
                an earthquake at TSMC
              </button>
              .
            </li>
          )}
        </ol>
      </section>

      {/* how it works */}
      <section className="border-y border-line bg-panel/40">
        <div className="max-w-[1320px] mx-auto px-4 sm:px-8 py-20 sm:py-24 space-y-12">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div className="space-y-4">
              <p className="eyebrow">how it reads a headline</p>
              <h2 className="display text-[40px] sm:text-[52px] max-w-[18ch]">
                Vector search finds documents. <em className="text-muted">This finds consequences.</em>
              </h2>
            </div>
            <Link href="/method" className="btn-quiet px-4 py-2 text-[13px]">
              Read the method <span aria-hidden>→</span>
            </Link>
          </div>
          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-px bg-line rounded-2xl overflow-hidden border border-line">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="bg-bg p-6 sm:p-7 space-y-6 group hover:bg-panel transition-colors duration-300">
                <div className="flex items-center justify-between">
                  <span className="num text-[12px] text-faint">0{i + 1}</span>
                  <span className="flex gap-1" aria-hidden>
                    {[0, 1, 2, 3].map((k) => (
                      <i key={k} className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${k <= i ? "bg-origin" : "bg-line-strong"}`} />
                    ))}
                  </span>
                </div>
                <div className="space-y-2.5">
                  <h3 className="display text-[30px]">{t}</h3>
                  <p className="text-[14px] leading-6 text-muted">{d}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {recent.length > 0 && (
        <section className="max-w-[1320px] mx-auto px-4 sm:px-8 py-16 grid lg:grid-cols-[0.8fr_1.6fr] gap-6 lg:gap-16">
          <p className="eyebrow pt-1 whitespace-nowrap">recently traced by visitors</p>
          <ul className="border-t border-line min-w-0">
            {recent.map((r) => (
              <li key={r.id}>
                <Link href={`/run/${r.id}`} className="group flex items-baseline justify-between gap-6 py-3.5 border-b border-line text-[14px] text-muted hover:text-text transition-colors">
                  <span className="truncate">{r.headline}</span>
                  <span className="num text-[11px] text-faint shrink-0">{timeAgo(r.created_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
