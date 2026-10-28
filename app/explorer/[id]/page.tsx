"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import { api, type EdgeInfo, type NodeInfo } from "@/lib/api";
import { SECTOR_LABELS, strengthText } from "@/lib/format";
import EgoGraph from "@/components/EgoGraph";
import { Badge, CoverageDot, Panel, SectionTitle } from "@/components/ui";

type CompanyData = {
  node: NodeInfo;
  edges: EdgeInfo[];
  nodes: NodeInfo[];
  documents: { form: string; filed_at: string; url: string }[];
};

const GROUPS = [
  { key: "sup", title: "Suppliers", test: (e: EdgeInfo, id: string) => e.rel === "supplies_to" && e.dst === id },
  { key: "cus", title: "Customers", test: (e: EdgeInfo, id: string) => e.rel === "supplies_to" && e.src === id },
  { key: "comp", title: "Competitors", test: (e: EdgeInfo) => e.rel === "competes_with" },
  { key: "ctx", title: "Regions & commodities", test: (e: EdgeInfo) => ["operates_in", "depends_on", "produces"].includes(e.rel) },
];

const COVERAGE_TEXT = {
  high: "Its own filing and several quoted links back this company's neighbourhood.",
  medium: "Some links are quoted from filings; others are missing or curated.",
  low: "Only curated links. Treat this neighbourhood as incomplete.",
  none: "No known links yet. That means unknown, not unexposed.",
};

export default function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const nodeId = decodeURIComponent(id);
  const [data, setData] = useState<CompanyData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<CompanyData>(`/companies/${encodeURIComponent(nodeId)}`).then(setData).catch((e) => setErr(e.message));
  }, [nodeId]);

  const names = useMemo(() => new Map((data?.nodes ?? []).map((n) => [n.id, n])), [data]);

  if (err) return <p className="p-6 text-hurt">{err}</p>;
  if (!data)
    return (
      <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-3">
        <div className="skeleton h-8 w-64" />
        <div className="skeleton h-[380px]" />
      </div>
    );

  const n = data.node;
  return (
    <div className="max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
      <Link href="/explorer" className="text-[12px] text-muted hover:text-text">← All companies</Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-[24px] font-semibold tracking-tight">{n.name}</h1>
            {n.ticker && <span className="num text-muted">{n.ticker}</span>}
          </div>
          <p className="text-[13px] text-muted">
            {SECTOR_LABELS[n.sector ?? ""] ?? n.sector} · {n.country}
            {!n.in_universe && " · named in a filing, outside the curated universe"}
          </p>
        </div>
        <div className="text-[12px] text-muted flex items-center gap-2 max-w-sm">
          <CoverageDot c={n.coverage} />
          <span>Coverage {n.coverage}. {COVERAGE_TEXT[n.coverage]}</span>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <Panel className="h-[420px] overflow-hidden">
          {data.edges.length ? (
            <EgoGraph center={n.id} nodes={[n, ...data.nodes]} edges={data.edges} />
          ) : (
            <p className="p-4 text-muted text-[13px]">No links for this company yet.</p>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel>
            <SectionTitle>Sources</SectionTitle>
            <ul className="px-3 pb-3 text-[13px] space-y-1">
              {data.documents.length ? (
                data.documents.map((d) => (
                  <li key={d.url}>
                    <a href={d.url} target="_blank" rel="noreferrer" className="text-help hover:underline">
                      {d.form} filed {d.filed_at} ↗
                    </a>
                  </li>
                ))
              ) : (
                <li className="text-muted">No SEC filing ingested for this company. Its links come from other companies’ filings or curation.</li>
              )}
            </ul>
          </Panel>
          <Panel>
            <SectionTitle>Link counts</SectionTitle>
            <dl className="px-3 pb-3 grid grid-cols-2 gap-2 text-[13px]">
              {GROUPS.map((g) => (
                <div key={g.key} className="flex justify-between border border-line rounded px-2 py-1.5">
                  <dt className="text-muted">{g.title}</dt>
                  <dd className="num">{data.edges.filter((e) => g.test(e, n.id)).length}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {GROUPS.map((g) => {
          const list = data.edges.filter((e) => g.test(e, n.id)).sort((a, b) => b.strength - a.strength);
          if (!list.length) return null;
          return (
            <Panel key={g.key}>
              <SectionTitle right={<span className="num text-[11px] text-faint">{list.length}</span>}>{g.title}</SectionTitle>
              <ul className="pb-2">
                {list.map((e) => {
                  const otherId = e.src === n.id ? e.dst : e.src;
                  const other = names.get(otherId);
                  const linkable = other?.kind === "company";
                  return (
                    <li key={e.id} className="px-3 py-2.5 border-t border-line/60 text-[13px]">
                      <div className="flex flex-wrap items-center gap-2">
                        {linkable ? (
                          <Link href={`/explorer/${encodeURIComponent(otherId)}`} className="font-medium hover:text-help">
                            {other?.name ?? otherId}
                          </Link>
                        ) : (
                          <span className="font-medium">{other?.name ?? otherId}</span>
                        )}
                        <Badge>{strengthText(e)}</Badge>
                        {e.quality === "verified" ? <Badge tone="ok">quoted</Badge> : <Badge tone="warn">{e.quality_reasons[0] ?? "speculative"}</Badge>}
                      </div>
                      {e.evidence?.length ? (
                        <blockquote className="mt-1.5 border-l-2 border-line-strong pl-2.5 text-muted text-[12.5px] leading-[18px]">
                          “{e.evidence[0].quote}”
                          <span className="block text-[11px] text-faint mt-0.5">
                            {e.evidence[0].source}
                            {e.evidence[0].url && (
                              <a className="ml-1.5 text-help hover:underline" href={e.evidence[0].url} target="_blank" rel="noreferrer">
                                filing ↗
                              </a>
                            )}
                            {e.evidence_ids.length > 1 && ` · +${e.evidence_ids.length - 1} more quotes`}
                          </span>
                        </blockquote>
                      ) : (
                        e.note && <p className="mt-1 text-[12px] text-faint italic">{e.note}</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
