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
    <ol className="flex flex-wrap items-center gap-y-1.5 text-[12px]" aria-label="Pipeline progress">
      {STAGES.map((s, i) => {
        const st = state[s.key];
        return (
          <li key={s.key} className="flex items-center">
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-all duration-300 ${
                st === "done"
                  ? "border-line-strong bg-white/[0.03] text-text"
                  : st === "active"
                    ? "border-origin/50 text-origin bg-origin-soft shadow-[0_0_20px_-6px_var(--origin)]"
                    : st === "error"
                      ? "border-hurt/50 text-hurt"
                      : "border-line text-faint"
              }`}
            >
              <Dot st={st} />
              {s.label}
              {detail?.[s.key] && <span className="text-muted num">{detail[s.key]}</span>}
            </span>
            {i < STAGES.length - 1 && (
              <span aria-hidden className={`w-3 sm:w-4 h-px transition-colors duration-500 ${st === "done" ? "bg-ok/50" : "bg-line-strong"}`} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function Dot({ st }: { st: StageState }) {
  if (st === "done")
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-label="done" className="text-ok">
        <path d="M2 5.2 4.1 7.3 8 3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
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
