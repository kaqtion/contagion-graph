// Portfolio holdings live in the viewer's browser only (no account needed).
export type HoldingRow = { ticker: string; weight: number };

const KEY = "cg.holdings.v1";

export function loadHoldings(): HoldingRow[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as HoldingRow[]) : [];
  } catch {
    return [];
  }
}

export function saveHoldings(rows: HoldingRow[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(rows));
  } catch {}
}
