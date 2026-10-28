export type StageState = "idle" | "active" | "done" | "error" | "skipped";

export const STAGES = [
  { key: "parse", label: "Parse event" },
  { key: "locate", label: "Locate origin" },
  { key: "trace", label: "Trace 3 hops" },
  { key: "score", label: "Score" },
  { key: "explain", label: "Explain" },
  { key: "critic", label: "Critic" },
] as const;

export type StageKey = (typeof STAGES)[number]["key"];

export default function StageChips({ state, detail }: { state: Record<StageKey, StageState>; detail?: Partial<Record<StageKey, string>> }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
      {STAGES.map((s, i) => {
        const st = state[s.key];
        return (
          <li key={s.key} className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 transition-colors ${
                st === "done"
                  ? "border-line-strong text-text"
                  : st === "active"
                    ? "border-origin/50 text-origin bg-origin-soft"
                    : st === "error"
                      ? "border-hurt/50 text-hurt"
                      : "border-line text-faint"
              }`}
            >
              <Dot st={st} />
              {s.label}
              {detail?.[s.key] && <span className="text-muted num">{detail[s.key]}</span>}
            </span>
            {i < STAGES.length - 1 && <span className="text-line-strong">›</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Dot({ st }: { st: StageState }) {
  if (st === "done") return <span className="text-ok">✓</span>;
  if (st === "error") return <span>!</span>;
  if (st === "active")
    return (
      <span className="relative inline-flex w-2 h-2">
        <span className="absolute inset-0 rounded-full bg-origin" style={{ animation: "pulse-ring 1.1s ease-out infinite" }} />
        <span className="relative w-2 h-2 rounded-full bg-origin" />
      </span>
    );
  return <span className="w-1.5 h-1.5 rounded-full bg-line-strong" />;
}
