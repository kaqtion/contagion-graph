// Types and fetch helpers for the Python API (/api/py/*).

export type NodeInfo = {
  id: string;
  kind: "company" | "region" | "commodity";
  name: string;
  ticker: string | null;
  sector: string | null;
  country: string | null;
  in_universe: boolean;
  coverage: "high" | "medium" | "low" | "none";
};

export type EvidenceQuote = { id: number; quote: string; source: string; url: string | null; as_of: string | null };

export type EdgeInfo = {
  id: number;
  src: string;
  dst: string;
  rel: "supplies_to" | "competes_with" | "operates_in" | "depends_on" | "produces";
  strength: number;
  tier: string;
  pct: number | null;
  strength_source: "disclosed" | "tier" | "curated";
  status: string;
  as_of: string | null;
  note: string | null;
  quality: "verified" | "speculative";
  quality_reasons: string[];
  evidence_ids: number[];
  evidence?: EvidenceQuote[];
};

export type PathStep = { edge_id: number; from: string; to: string; kind: string };

export type ScoredPath = {
  origin: string;
  nodes: string[];
  steps: PathStep[];
  contribution: number;
  math: { severity: number; polarity: number; terms: { w: number; s: number }[]; decay: number; freshness: number };
  quality: "verified" | "speculative";
  quality_reasons: string[];
};

export type Exposure = {
  id: string;
  name: string;
  ticker: string | null;
  sector: string | null;
  coverage: NodeInfo["coverage"];
  in_universe: boolean;
  kind: NodeInfo["kind"];
  impact: number;
  hop: number;
  paths: ScoredPath[];
  path_count: number;
  quality: "verified" | "speculative";
  is_origin: boolean;
};

export type EventInfo = {
  event_type: string;
  polarity: "negative" | "positive";
  severity: number;
  expected_duration: string;
  origin_companies: string[];
  regions: string[];
  commodities: string[];
  summary: string;
};

export type Claim = { text: string; evidence_ids: number[]; supported?: boolean; issue?: string };

export type Explanation = {
  summary: string;
  companies: { id: string; rationale: string; claims: Claim[] }[];
  critic?: { claims: number; supported: number };
};

export type RunData = {
  id: string;
  created_at: string;
  headline: string;
  event: EventInfo;
  result: {
    origins: { id: string; name: string; kind: string }[];
    unresolved_origins: string[];
    exposures: Exposure[];
    all_scores: Record<string, [number, number]>;
    graph: { nodes: NodeInfo[]; edges: EdgeInfo[] };
    stats: { paths: number; reached: number; by_hop: Record<string, number>; hurt: number; helped: number };
    note: string | null;
  };
  explanation: Explanation | null;
  cost_usd: number;
  is_demo: boolean;
};

export type RunSummary = {
  id: string;
  headline: string;
  created_at: string;
  is_demo: boolean;
  event_type: string;
  severity: number;
  reached: number;
  explained: boolean;
};

export type Health = {
  ok: boolean;
  database: string;
  persistent: boolean;
  llm_enabled: boolean;
  models: { event: string; explain: string };
  graph: {
    companies: number;
    external_companies: number;
    edges: number;
    verified_edges: number;
    curated_edges: number;
    evidence_quotes: number;
  };
  budget: { spent_today_usd: number; daily_budget_usd: number };
  passcode_required: boolean;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/py${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") msg = body.detail;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json();
}

export const post = <T,>(path: string, body: unknown, headers?: Record<string, string>) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body), headers });
