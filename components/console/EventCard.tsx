import type { RunData } from "@/lib/api";
import { EVENT_LABELS } from "@/lib/format";
import { Badge } from "@/components/ui";

export default function EventCard({ run }: { run: RunData }) {
  const ev = run.event;
  const r = run.result;
  return (
    <div className="px-3 pb-3 space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={ev.polarity === "negative" ? "hurt" : "help"}>{EVENT_LABELS[ev.event_type] ?? ev.event_type}</Badge>
        <Badge>{ev.expected_duration}</Badge>
        {run.is_demo && <Badge tone="origin">example</Badge>}
      </div>
      <p className="text-[13px] leading-5 text-text">{ev.summary}</p>
      <dl className="grid grid-cols-[88px_1fr] gap-y-2 text-[12px]">
        <dt className="text-faint">Severity</dt>
        <dd className="flex items-center gap-2">
          <span className="flex gap-0.5">
            {[1, 2, 3, 4, 5].map((i) => (
              <span key={i} className={`w-3.5 h-1.5 rounded-sm ${i <= ev.severity ? (ev.polarity === "negative" ? "bg-hurt" : "bg-help") : "bg-line-strong"}`} />
            ))}
          </span>
          <span className="num text-muted">{ev.severity}/5</span>
        </dd>
        <dt className="text-faint">Origin</dt>
        <dd className="flex flex-wrap gap-1">
          {r.origins.length ? (
            r.origins.map((o) => (
              <Badge key={o.id} tone="origin">
                {o.kind === "region" ? "◇ " : o.kind === "commodity" ? "◆ " : ""}
                {o.name}
              </Badge>
            ))
          ) : (
            <span className="text-muted">none found in graph</span>
          )}
        </dd>
        {r.unresolved_origins.length > 0 && (
          <>
            <dt className="text-faint">Not in graph</dt>
            <dd className="text-warn">{r.unresolved_origins.join(", ")}</dd>
          </>
        )}
        <dt className="text-faint">Reached</dt>
        <dd className="num text-muted">
          {r.stats.reached} companies · <span className="text-hurt">{r.stats.hurt} hurt</span> ·{" "}
          <span className="text-help">{r.stats.helped} helped</span>
        </dd>
        <dt className="text-faint">By hop</dt>
        <dd className="num text-muted">
          {Object.entries(r.stats.by_hop)
            .filter(([h]) => h !== "0")
            .map(([h, n]) => `${n} at hop ${h}`)
            .join(" · ") || "–"}
        </dd>
      </dl>
      {r.note && <p className="text-[12px] leading-5 text-warn border border-warn/30 bg-warn/5 rounded-md px-2.5 py-2">{r.note}</p>}
    </div>
  );
}
