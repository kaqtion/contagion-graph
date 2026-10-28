"use client";

import { useCallback, useEffect, useState } from "react";
import { api, post, type EdgeInfo } from "@/lib/api";
import { strengthText } from "@/lib/format";
import { Badge, Panel, SectionTitle } from "@/components/ui";

type Queue = {
  flagged: EdgeInfo[];
  rejected: { id: number; src: string; dst: string; rel: string }[];
  unresolved: { raw: string; count: number; example: string | null }[];
  nodes: Record<string, string>;
};

const TOKEN_KEY = "cg.admin";

export default function ReviewPage() {
  const [token, setToken] = useState("");
  const [queue, setQueue] = useState<Queue | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tab, setTab] = useState<"flagged" | "unresolved" | "rejected">("flagged");

  const load = useCallback(async (t: string) => {
    try {
      setQueue(await api<Queue>("/review", { headers: { "x-admin-token": t } }));
      setErr(null);
      try {
        sessionStorage.setItem(TOKEN_KEY, t);
      } catch {}
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed");
      setQueue(null);
    }
  }, []);

  useEffect(() => {
    try {
      const t = sessionStorage.getItem(TOKEN_KEY);
      if (t) {
        setToken(t);
        void load(t);
      }
    } catch {}
  }, [load]);

  const act = async (edgeId: number, action: "reject" | "restore") => {
    await post(`/review/${edgeId}`, { action }, { "x-admin-token": token });
    await load(token);
  };

  const name = (id: string) => queue?.nodes[id] ?? id;

  return (
    <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 space-y-5">
      <header className="space-y-1">
        <h1 className="text-[22px] font-semibold tracking-tight">Review queue</h1>
        <p className="text-muted text-[14px]">
          Edges the critic marks speculative (no quote, stale or weak) and names the resolver could not match. Rejected edges drop out of every trace
          and stay rejected when the graph is rebuilt.
        </p>
      </header>
      {!queue && (
        <form
          className="flex gap-2 max-w-md"
          onSubmit={(e) => {
            e.preventDefault();
            void load(token);
          }}
        >
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Admin token"
            className="flex-1 bg-panel border border-line-strong rounded px-3 py-2 text-[14px] outline-none focus:border-origin/60"
          />
          <button className="px-4 rounded bg-raise hover:bg-line-strong text-[14px]">Open</button>
        </form>
      )}
      {err && <p className="text-hurt text-[13px]">{err}</p>}
      {queue && (
        <>
          <div className="flex gap-1">
            {(["flagged", "unresolved", "rejected"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`px-3 py-1 rounded text-[13px] capitalize ${tab === t ? "bg-raise" : "text-muted hover:text-text"}`}>
                {t} <span className="num text-faint">{queue[t].length}</span>
              </button>
            ))}
          </div>
          <Panel>
            {tab === "flagged" && (
              <ul>
                {queue.flagged.map((e) => (
                  <li key={e.id} className="px-3 py-2.5 border-b border-line/60 last:border-0 flex flex-wrap items-start justify-between gap-3 text-[13px]">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>
                          {name(e.src)} <span className="text-faint">{e.rel.replace("_", " ")}</span> {name(e.dst)}
                        </span>
                        <Badge>{strengthText(e)}</Badge>
                        {e.quality_reasons.map((r) => (
                          <Badge key={r} tone="warn">{r}</Badge>
                        ))}
                      </div>
                      {e.note && <p className="text-[12px] text-faint mt-0.5">{e.note}</p>}
                      {e.evidence?.[0] && <p className="text-[12px] text-muted mt-0.5">“{e.evidence[0].quote}”</p>}
                    </div>
                    <button onClick={() => act(e.id, "reject")} className="px-2.5 py-1 rounded border border-hurt/40 text-hurt text-[12px] hover:bg-hurt-soft">
                      Reject
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {tab === "unresolved" && (
              <>
                <SectionTitle>Add aliases for these in data/universe.csv, then rebuild the graph</SectionTitle>
                <ul>
                  {queue.unresolved.map((u) => (
                    <li key={u.raw} className="px-3 py-2 border-t border-line/60 text-[13px]">
                      <span className="font-medium">{u.raw}</span> <span className="num text-faint">×{u.count}</span>
                      {u.example && <p className="text-[12px] text-muted mt-0.5 line-clamp-2">“{u.example}”</p>}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {tab === "rejected" && (
              <ul>
                {queue.rejected.map((e) => (
                  <li key={e.id} className="px-3 py-2.5 border-b border-line/60 last:border-0 flex justify-between gap-3 text-[13px]">
                    <span>
                      {name(e.src)} <span className="text-faint">{e.rel.replace("_", " ")}</span> {name(e.dst)}
                    </span>
                    <button onClick={() => act(e.id, "restore")} className="px-2.5 py-1 rounded border border-line-strong text-[12px] hover:bg-raise">
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
