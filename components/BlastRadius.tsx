// Decorative hero illustration: a stylised trace of a TSMC shock rippling out three hops.
const RINGS = [96, 178, 258];

type N = { id: string; hop: 1 | 2 | 3; deg: number; size: number; tone: "hurt" | "help"; parent?: string };

const NODES: N[] = [
  { id: "AAPL", hop: 1, deg: -62, size: 11, tone: "hurt" },
  { id: "NVDA", hop: 1, deg: -12, size: 10, tone: "hurt" },
  { id: "AMD", hop: 1, deg: 34, size: 8.5, tone: "hurt" },
  { id: "AVGO", hop: 1, deg: 82, size: 8, tone: "hurt" },
  { id: "QCOM", hop: 1, deg: 138, size: 7, tone: "hurt" },
  { id: "INTC", hop: 1, deg: 196, size: 7.5, tone: "help" },
  { id: "SSNLF", hop: 1, deg: 248, size: 6.5, tone: "help" },
  { id: "FOXCONN", hop: 2, deg: -84, size: 6, tone: "hurt", parent: "AAPL" },
  { id: "HPE", hop: 2, deg: -32, size: 7, tone: "hurt", parent: "NVDA" },
  { id: "DELL", hop: 2, deg: -6, size: 6, tone: "hurt", parent: "NVDA" },
  { id: "SMCI", hop: 2, deg: 18, size: 5.5, tone: "hurt", parent: "AMD" },
  { id: "CRDO", hop: 2, deg: 62, size: 5, tone: "hurt", parent: "AVGO" },
  { id: "ANET", hop: 2, deg: 98, size: 5.5, tone: "hurt", parent: "AVGO" },
  { id: "XIAOMI", hop: 2, deg: 152, size: 4.5, tone: "hurt", parent: "QCOM" },
  { id: "GFS", hop: 2, deg: 212, size: 4.5, tone: "help", parent: "INTC" },
  { id: "a", hop: 3, deg: -98, size: 3, tone: "hurt", parent: "FOXCONN" },
  { id: "b", hop: 3, deg: -44, size: 3.5, tone: "hurt", parent: "HPE" },
  { id: "c", hop: 3, deg: -20, size: 3, tone: "hurt", parent: "HPE" },
  { id: "d", hop: 3, deg: 6, size: 3, tone: "hurt", parent: "DELL" },
  { id: "e", hop: 3, deg: 28, size: 2.5, tone: "hurt", parent: "SMCI" },
  { id: "f", hop: 3, deg: 74, size: 3, tone: "hurt", parent: "CRDO" },
  { id: "g", hop: 3, deg: 110, size: 2.5, tone: "hurt", parent: "ANET" },
  { id: "h", hop: 3, deg: 164, size: 2.5, tone: "hurt", parent: "XIAOMI" },
  { id: "i", hop: 3, deg: 222, size: 2.5, tone: "help", parent: "GFS" },
];

const pos = (hop: number, deg: number) => {
  const r = RINGS[hop - 1];
  const a = (deg * Math.PI) / 180;
  // rounded so server and client render identical attributes
  return { x: Math.round(r * Math.cos(a) * 10) / 10, y: Math.round(r * Math.sin(a) * 10) / 10 };
};

export default function BlastRadius({ className = "" }: { className?: string }) {
  const at = new Map(NODES.map((n) => [n.id, pos(n.hop, n.deg)]));
  return (
    <svg viewBox="-300 -300 600 600" className={className} role="img" aria-label="Illustration: a shock at TSMC spreading to customers, then their customers">
      <defs>
        <radialGradient id="br-glow">
          <stop offset="0%" stopColor="var(--origin)" stopOpacity="0.32" />
          <stop offset="40%" stopColor="var(--hurt)" stopOpacity="0.07" />
          <stop offset="100%" stopColor="var(--bg)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle r="290" fill="url(#br-glow)" />
      <g className="slow-spin">
        {RINGS.map((r, i) => (
          <circle key={r} r={r} fill="none" stroke="var(--line-strong)" strokeWidth="1" strokeDasharray={i === 2 ? "2 6" : i === 1 ? "1 4" : undefined} />
        ))}
      </g>
      {[0, 1.8, 3.6].map((d) => (
        <circle key={d} r={RINGS[2]} fill="none" stroke="var(--origin)" strokeWidth="1" className="ripple" style={{ animationDelay: `${d}s` }} />
      ))}
      {RINGS.map((r, i) => (
        <text key={r} x={-r + 6} y={-6} className="num" fontSize="9" fill="var(--faint)">
          hop {i + 1}
        </text>
      ))}

      <g>
        {NODES.map((n, i) => {
          const from = n.parent ? at.get(n.parent)! : { x: 0, y: 0 };
          const to = at.get(n.id)!;
          return (
            <line
              key={`e-${n.id}`}
              x1={from.x} y1={from.y} x2={to.x} y2={to.y}
              pathLength={1}
              className="draw"
              stroke={n.tone === "hurt" ? "var(--hurt)" : "var(--help)"}
              strokeOpacity={n.hop === 1 ? 0.55 : n.hop === 2 ? 0.35 : 0.22}
              strokeWidth={n.hop === 1 ? 1.4 : 1}
              style={{ animationDelay: `${(0.3 + n.hop * 0.35 + i * 0.03).toFixed(2)}s` }}
            />
          );
        })}
      </g>

      {NODES.map((n, i) => {
        const p = at.get(n.id)!;
        const c = n.tone === "hurt" ? "var(--hurt)" : "var(--help)";
        const labelled = n.hop < 3;
        const right = p.x >= 0;
        return (
          <g key={n.id} className="fade-up" style={{ animationDelay: `${(0.5 + n.hop * 0.35 + i * 0.03).toFixed(2)}s` }}>
            <circle cx={p.x} cy={p.y} r={n.size + 5} fill={c} opacity="0.12" className="blip" style={{ animationDelay: `${(i % 7) * 0.5}s` }} />
            <circle cx={p.x} cy={p.y} r={n.size} fill={c} />
            {labelled && (
              <text
                x={p.x + (right ? n.size + 6 : -n.size - 6)}
                y={p.y + 3.5}
                textAnchor={right ? "start" : "end"}
                fontSize={n.hop === 1 ? 11 : 9.5}
                fill={n.hop === 1 ? "var(--text)" : "var(--muted)"}
                className="num"
                paintOrder="stroke"
                stroke="var(--bg)"
                strokeWidth="3"
              >
                {n.id}
              </text>
            )}
          </g>
        );
      })}

      <circle r="30" fill="var(--origin)" opacity="0.14" className="blip" />
      <circle r="17" fill="var(--origin)" />
      <circle r="17" fill="none" stroke="var(--bg)" strokeWidth="2" opacity="0.4" />
      <text y="4" textAnchor="middle" fontSize="10" fontWeight="600" fill="#17120a" className="num">
        TSM
      </text>
    </svg>
  );
}
