"""Step 6: event-study back-test on historical shocks.

    python -m scripts.backtest            # graph method + same-sector baseline (free)
    python -m scripts.backtest --llm      # also the "LLM from memory" baseline (a fraction of a cent)

For each event we trace a hand-written event through today's graph, then compare predictions with
market-adjusted returns: CAR(0..k) = stock return - SPY return from the close before day 0.

Caveat: the graph is built from recent filings, so this has look-ahead bias. It tests whether the
propagation logic points at the right companies, not what the strategy would have earned.
"""
from __future__ import annotations

import json
import sys
import warnings
from datetime import date, timedelta

import pandas as pd
import yfinance as yf
from sqlalchemy import delete

from contagion import config, llm
from contagion.db import Backtest, init_db, session
from contagion.graph import get_graph
from contagion.pipeline import resolve_origins, trace

warnings.filterwarnings("ignore")

EVENTS = [
    {"key": "renesas-2021", "date": "2021-03-19", "headline": "Fire at Renesas Naka fab halts automotive chip production",
     "event": {"event_type": "supply_disruption", "polarity": "negative", "severity": 4, "expected_duration": "months",
               "origin_companies": ["Renesas Electronics"], "regions": ["Japan"], "commodities": [], "summary": ""}},
    {"key": "texas-freeze-2021", "date": "2021-02-16", "headline": "Texas winter storm shuts Samsung, NXP and Infineon fabs in Austin",
     "event": {"event_type": "supply_disruption", "polarity": "negative", "severity": 3, "expected_duration": "weeks",
               "origin_companies": ["Samsung", "NXP", "Infineon"], "regions": ["United States"], "commodities": [], "summary": ""}},
    {"key": "tohoku-2011", "date": "2011-03-11", "headline": "Magnitude 9 earthquake and tsunami hit northeast Japan",
     "event": {"event_type": "regional_disaster", "polarity": "negative", "severity": 5, "expected_duration": "months",
               "origin_companies": [], "regions": ["Japan"], "commodities": [], "summary": ""}},
    {"key": "export-controls-2022", "date": "2022-10-10", "headline": "US imposes sweeping export controls on chips and chipmaking tools for China",
     "event": {"event_type": "sanctions_trade", "polarity": "negative", "severity": 4, "expected_duration": "permanent",
               "origin_companies": [], "regions": ["China"], "commodities": [], "summary": ""}},
    {"key": "hualien-2024", "date": "2024-04-03", "headline": "Magnitude 7.4 earthquake in Taiwan briefly halts TSMC fabs",
     "event": {"event_type": "regional_disaster", "polarity": "negative", "severity": 3, "expected_duration": "days",
               "origin_companies": ["TSMC"], "regions": ["Taiwan"], "commodities": [], "summary": ""}},
]

HORIZONS = (1, 5, 10)


def car_table(tickers: list[str], day0: str) -> pd.DataFrame:
    d0 = date.fromisoformat(day0)
    px = yf.download(tickers + ["SPY"], start=str(d0 - timedelta(days=12)), end=str(d0 + timedelta(days=25)),
                     auto_adjust=True, progress=False, threads=True)["Close"]
    px = px.dropna(how="all")
    before = px[px.index < pd.Timestamp(d0)]
    after = px[px.index >= pd.Timestamp(d0)]
    if before.empty or after.empty:
        return pd.DataFrame()
    base = before.iloc[-1]
    rows = {}
    for h in HORIZONS:
        if len(after) <= h - 1:
            continue
        ret = after.iloc[h - 1] / base - 1
        rows[f"car{h}"] = ret - ret["SPY"]
    df = pd.DataFrame(rows).drop(index="SPY", errors="ignore")
    return df.dropna()


def llm_memory_baseline(headline: str) -> list[str]:
    schema = {"type": "object", "properties": {"tickers": {"type": "array", "items": {"type": "string"}}},
              "required": ["tickers"], "additionalProperties": False}
    out, _ = llm.json_call(purpose="backtest", model=config.MODEL_EVENT,
                           system="You are an equity analyst. Answer from memory only.",
                           user=f"News: {headline}\nList up to 15 US-listed tickers (including ADRs) most likely to fall "
                                f"because of this, excluding the company named in the news.", schema=schema, max_tokens=1500)
    return [t.upper() for t in out["tickers"]]


def summarize(name: str, picks: list[str], cars: pd.DataFrame, horizon: str = "car5") -> dict:
    vals = [float(cars.loc[t, horizon]) for t in picks if t in cars.index]
    return {
        "method": name,
        "n": len(vals),
        "mean_car": round(sum(vals) / len(vals), 4) if vals else None,
        "hit_rate": round(sum(v < 0 for v in vals) / len(vals), 3) if vals else None,
    }


def main(with_llm: bool) -> None:
    init_db()
    g = get_graph()
    tickers = sorted({n["ticker"] for n in g.nodes.values() if n["kind"] == "company" and n["ticker"]})
    sector_of = {n["ticker"]: n["sector"] for n in g.nodes.values() if n.get("ticker")}
    results = []
    for ev in EVENTS:
        print(f"== {ev['key']}")
        result = trace(g, ev["event"])
        cars = car_table(tickers, ev["date"])
        if cars.empty:
            print("   no price data")
            continue
        origins, _ = resolve_origins(g, ev["event"])
        origin_tickers = {g.nodes[o]["ticker"] for o in origins if g.nodes[o].get("ticker")}
        scored = {g.nodes[i]["ticker"]: v[0] for i, v in result["all_scores"].items()
                  if g.nodes.get(i, {}).get("ticker") and i not in origins}
        # graph method: the 15 most-hurt companies that trade in the US
        hurt = sorted(((t, s) for t, s in scored.items() if s < 0 and t in cars.index), key=lambda kv: kv[1])[:15]
        graph_picks = [t for t, _ in hurt]
        # baseline 1: same-sector peers of the origin companies (or of the most hurt sector for region events)
        origin_sectors = {g.nodes[o]["sector"] for o in origins if g.nodes[o]["kind"] == "company"}
        if not origin_sectors and graph_picks:
            origin_sectors = {sector_of[graph_picks[0]]}
        sector_picks = [t for t in cars.index if sector_of.get(t) in origin_sectors and t not in origin_tickers]
        methods = [summarize("Contagion graph", graph_picks, cars), summarize("Same-sector peers", sector_picks, cars),
                   summarize("Whole universe", list(cars.index), cars)]
        if with_llm and config.llm_enabled():
            picks = [t for t in llm_memory_baseline(ev["headline"]) if t not in origin_tickers]
            methods.append(summarize("LLM from memory", picks, cars))
        points = []
        for t in cars.index:
            if t in origin_tickers:
                continue
            node = next((n for n in g.nodes.values() if n.get("ticker") == t), None)
            points.append({"ticker": t, "name": node["name"] if node else t, "impact": round(scored.get(t, 0.0), 4),
                           "car1": round(float(cars.loc[t, "car1"]), 4) if "car1" in cars else None,
                           "car5": round(float(cars.loc[t, "car5"]), 4) if "car5" in cars else None,
                           "car10": round(float(cars.loc[t, "car10"]), 4) if "car10" in cars else None})
        reached = [p for p in points if p["impact"] != 0 and p["car5"] is not None]
        rho = None
        if len(reached) >= 5:
            s = pd.DataFrame(reached)
            rho = round(float(s["impact"].rank().corr(s["car5"].rank())), 3)  # Spearman without scipy
        data = {"key": ev["key"], "date": ev["date"], "headline": ev["headline"], "event": ev["event"],
                "origins": [g.nodes[o]["name"] for o in origins], "methods": methods, "spearman_reached": rho,
                "n_reached": len(reached), "points": points, "horizon": "car5"}
        results.append(data)
        for m in methods:
            print(f"   {m['method']:20} n={m['n']:3} mean CAR5={m['mean_car']}  hit={m['hit_rate']}")
        print(f"   spearman(impact, CAR5) over {len(reached)} reached = {rho}")
    with session() as s:
        s.execute(delete(Backtest))
        for r in results:
            s.add(Backtest(key=r["key"], data=r))
        s.commit()
    (config.DATA / "backtests.json").write_text(json.dumps(results, indent=1))


if __name__ == "__main__":
    main("--llm" in sys.argv)
