"""Online pipeline: headline -> event -> origins -> paths -> scores, then explanation + critic on demand.

Stage 1 (analyze) costs one small LLM call and is cached per headline. Stage 2 (explain) costs two calls and is
cached on the run, so revisiting a run is free.
"""
from __future__ import annotations

import hashlib
import re
import secrets

from . import llm
from .agents import critic, event_parser, explainer, navigator, scorer
from .agents.navigator import TEMPLATES
from .agents.resolver import Resolver, commodity_id, region_id
from .db import Run, select, session
from .graph import Graph, get_graph

TOP_N = 60


def headline_key(headline: str) -> str:
    return hashlib.sha256(re.sub(r"\W+", " ", headline.lower()).strip().encode()).hexdigest()


def resolve_origins(g: Graph, event: dict) -> tuple[list[str], list[str]]:
    resolver = Resolver()
    origins: list[str] = []
    unresolved: list[str] = []
    for name in event.get("origin_companies", []):
        m = resolver.resolve(name)
        if m.node_id and m.node_id in g.nodes:
            origins.append(m.node_id)
        else:
            unresolved.append(name)
    tpl = TEMPLATES[event["event_type"]]
    if tpl["region_seed"] and (not origins or event["event_type"] in ("regional_disaster", "sanctions_trade")):
        for r in event.get("regions", []):
            rid = region_id(r)
            if rid and rid in g.nodes:
                origins.append(rid)
    if event["event_type"] == "commodity_shock":
        for c in event.get("commodities", []):
            cid = commodity_id(c)
            if cid and cid in g.nodes:
                origins.append(cid)
            else:
                unresolved.append(c)
    return list(dict.fromkeys(origins)), unresolved


def trace(g: Graph, event: dict) -> dict:
    """Deterministic part of the pipeline: resolve origins, traverse, score."""
    origins, unresolved = resolve_origins(g, event)
    polarity = -1 if event["polarity"] == "negative" else 1
    paths = navigator.find_paths(g, origins, event["event_type"])
    rows = scorer.score(g, paths, origins, event["severity"], polarity)
    note = None
    if event["event_type"] == "macro_rates":
        note = ("Macro and rate events have no specific origin in the supply graph, so this version does not "
                "trace them. Sector-level rate sensitivity is on the roadmap.")
    elif not origins:
        note = "None of the named companies, regions or commodities are in the graph yet, so nothing was traced."

    top = rows[:TOP_N]
    edge_ids = {st["edge_id"] for r in top for p in r["paths"] for st in p["steps"]}
    node_ids = set(origins) | {r["id"] for r in top} | {n for r in top for p in r["paths"] for n in p["nodes"]}
    for r in top:
        r.update({k: g.nodes[r["id"]][k] for k in ("name", "ticker", "sector", "coverage", "in_universe", "kind")})
    hops = {}
    for r in rows:
        hops[r["hop"]] = hops.get(r["hop"], 0) + 1
    return {
        "origins": [{"id": o, "name": g.nodes[o]["name"], "kind": g.nodes[o]["kind"]} for o in origins],
        "unresolved_origins": unresolved,
        "exposures": top,
        "all_scores": {r["id"]: [r["impact"], r["hop"]] for r in rows},
        "graph": {
            "nodes": [g.nodes[n] for n in node_ids if n in g.nodes],
            "edges": [g.edge_json(g.edges[e]) for e in edge_ids if e in g.edges],
        },
        "stats": {"paths": len(paths), "reached": len(rows) - sum(1 for r in rows if r["is_origin"]),
                  "by_hop": hops, "hurt": sum(1 for r in rows if r["impact"] < 0 and not r["is_origin"]),
                  "helped": sum(1 for r in rows if r["impact"] > 0 and not r["is_origin"])},
        "note": note,
    }


def find_cached(headline: str) -> Run | None:
    with session() as s:
        return s.scalars(select(Run).where(Run.headline_hash == headline_key(headline))
                         .order_by(Run.created_at.desc())).first()


def analyze(headline: str, ip_hash: str | None = None, event: dict | None = None, is_demo: bool = False) -> Run:
    """Stage 1. Pass `event` to skip the LLM parser (used for demos and back-tests)."""
    cached = find_cached(headline)
    if cached and event is None:
        return cached
    cost = 0.0
    if event is None:
        llm.check_budget(ip_hash)
        event, cost = event_parser.parse_event(headline, ip_hash)
    g = get_graph()
    result = trace(g, event)
    run = Run(id=secrets.token_urlsafe(6).replace("-", "x").replace("_", "y"), headline=headline,
              headline_hash=headline_key(headline), event=event, result=result, cost_usd=cost, is_demo=is_demo)
    with session() as s:
        s.add(run)
        s.commit()
    return run


def explain(run_id: str, ip_hash: str | None = None) -> Run:
    """Stage 2: explanation with citations, then the critic pass."""
    with session() as s:
        run = s.get(Run, run_id)
        if run is None:
            raise KeyError(run_id)
        if run.explanation:
            return run
    llm.check_budget(ip_hash)
    g = get_graph()
    rows = run.result["exposures"]
    explanation, c1 = explainer.explain(g, run.event, rows, ip_hash)
    explanation, c2 = critic.check(g, explanation, ip_hash)
    with session() as s:
        run = s.get(Run, run_id)
        run.explanation = explanation
        run.cost_usd = (run.cost_usd or 0) + c1 + c2
        s.commit()
    return run


def run_json(run: Run) -> dict:
    return {"id": run.id, "created_at": run.created_at.isoformat() + "Z", "headline": run.headline,
            "event": run.event, "result": run.result, "explanation": run.explanation,
            "cost_usd": round(run.cost_usd or 0, 5), "is_demo": run.is_demo}
