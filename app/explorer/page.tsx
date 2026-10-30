"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api, type NodeInfo } from "@/lib/api";
import { SECTOR_LABELS } from "@/lib/format";
import { CoverageDot, PageHeader } from "@/components/ui";

type Row = NodeInfo & { degree: number };

export default function ExplorerPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState("");
  const [sector, setSector] = useState<string | null>(null);

  useEffect(() => {
    api<Row[]>("/companies?limit=500").then(setRows).catch(() => setRows([]));
  }, []);

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (r) =>
        (!sector || r.sector === sector) &&
        (!ql || r.name.toLowerCase().includes(ql) || (r.ticker ?? "").toLowerCase().startsWith(ql) || r.id.toLowerCase() === ql),
    );
  }, [rows, q, sector]);

  const sectors = useMemo(() => {
    const m = new Map<string, number>();
    (rows ?? []).forEach((r) => r.sector && m.set(r.sector, (m.get(r.sector) ?? 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [rows]);

  return (
    <div className="max-w-[1320px] w-full mx-auto px-4 sm:px-8 py-8 sm:py-10 space-y-8">
      <PageHeader eyebrow="the graph, company by company" title="Explorer." accent="Every link, with its receipt.">
        Every company in the graph, its suppliers, customers and competitors, and the filing quote behind each link.
      </PageHeader>
      <div className="flex flex-col sm:flex-row gap-3">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name or ticker"
          className="h-10 self-start bg-panel border border-line-strong rounded-xl px-3.5 text-[14px] outline-none focus:border-origin/60 transition-colors sm:w-80 shrink-0"
        />
        <div className="flex flex-wrap gap-1.5">
          <Chip on={!sector} onClick={() => setSector(null)}>All</Chip>
          {sectors.map(([s, n]) => (
            <Chip key={s} on={sector === s} onClick={() => setSector(s)}>
              {SECTOR_LABELS[s] ?? s} <span className="text-faint num">{n}</span>
            </Chip>
          ))}
        </div>
      </div>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {rows === null && Array.from({ length: 9 }).map((_, i) => <div key={i} className="skeleton h-[62px]" />)}
        {list.map((r) => (
          <Link key={r.id} href={`/explorer/${encodeURIComponent(r.id)}`} className="border border-line rounded-lg px-3 py-2.5 bg-panel hover:border-line-strong hover:bg-panel-2 transition-colors">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium truncate">{r.name}</span>
              <span className="num text-[12px] text-muted shrink-0">{r.ticker ?? ""}</span>
            </div>
            <div className="flex items-center justify-between text-[11.5px] text-faint mt-0.5">
              <span>{SECTOR_LABELS[r.sector ?? ""] ?? r.sector} · {r.country}</span>
              <span className="flex items-center gap-2">
                <span className="num">{r.degree} links</span>
                <CoverageDot c={r.coverage} />
              </span>
            </div>
          </Link>
        ))}
      </div>
      {rows !== null && !list.length && <p className="text-muted text-[14px]">No companies match.</p>}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`px-2.5 py-1 rounded-full border text-[12px] transition-colors ${on ? "border-origin/50 bg-origin-soft text-origin" : "border-line text-muted hover:text-text"}`}>
      {children}
    </button>
  );
}
