import type { EdgeInfo } from "./api";

export const EVENT_LABELS: Record<string, string> = {
  supply_disruption: "Supply disruption",
  regional_disaster: "Regional disaster",
  demand_shock: "Demand shock",
  financial_distress: "Financial distress",
  commodity_shock: "Commodity shock",
  sanctions_trade: "Sanctions / trade",
  regulatory: "Regulatory",
  cyber_outage: "Cyber / outage",
  capacity_expansion: "Capacity expansion",
  macro_rates: "Macro / rates",
};

export const SECTOR_LABELS: Record<string, string> = {
  semis: "Semiconductors",
  foundry: "Foundry",
  osat: "Packaging & test",
  memory: "Memory & storage",
  equipment: "Chip equipment",
  materials: "Materials",
  hardware: "Hardware",
  cloud: "Cloud & platforms",
  ems: "Contract manufacturing",
  autos: "Automakers",
  auto_parts: "Auto parts & batteries",
};

export function impactColor(v: number | null | undefined): string {
  if (v == null || v === 0) return "var(--faint)";
  return v < 0 ? "var(--hurt)" : "var(--help)";
}

export function fmtImpact(v: number | null | undefined): string {
  if (v == null) return "–";
  const s = Math.abs(v) < 0.0005 ? "0.000" : Math.abs(v).toFixed(3);
  return (v < 0 ? "−" : v > 0 ? "+" : "") + s;
}

export function label(n: { ticker?: string | null; name: string; id: string; kind?: string }): string {
  if (n.ticker) return n.ticker;
  if (n.kind === "region" || n.kind === "commodity") return n.name;
  if (n.name.length <= 12) return n.name;
  // long names: our short ids (SMIC, CATL, FOXCONN) read better than a truncated legal name
  return n.id.startsWith("ext:") ? n.name.split(/[\s(]/)[0] : n.id;
}

export function relPhrase(e: EdgeInfo, names: (id: string) => string): string {
  const a = names(e.src);
  const b = names(e.dst);
  switch (e.rel) {
    case "supplies_to":
      return `${a} supplies ${b}`;
    case "competes_with":
      return `${a} competes with ${b}`;
    case "operates_in":
      return `${a} operates in ${b}`;
    case "depends_on":
      return `${a} depends on ${b}`;
    case "produces":
      return `${a} produces ${b}`;
  }
}

export function strengthText(e: EdgeInfo): string {
  if (e.pct != null) return `${e.pct}% disclosed`;
  const tier = e.tier === "sole" ? "sole source" : e.tier;
  return e.strength_source === "curated" ? `${tier} · curated` : tier;
}

export function hopLabel(h: number): string {
  return h === 0 ? "Origin" : `Hop ${h}`;
}

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
