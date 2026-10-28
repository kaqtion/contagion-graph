"""FastAPI app. Served under /api/py both locally (uvicorn) and on Vercel (api/index.py)."""
from __future__ import annotations

import json
import time

import httpx
from fastapi import APIRouter, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import or_

from . import config, llm, pipeline
from .agents.resolver import Resolver
from .db import Backtest, Document, Edge, Node, ReviewDecision, Run, Unresolved, init_db, select, session
from .graph import get_graph, invalidate

app = FastAPI(title="Contagion Graph API", docs_url="/api/py/docs", openapi_url="/api/py/openapi.json")
router = APIRouter(prefix="/api/py")
init_db()


def client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.headers.get("x-real-ip") or (request.client.host if request.client else None)


@router.get("/health")
def health() -> dict:
    g = get_graph()
    return {
        "ok": True,
        "database": "sqlite" if config.IS_SQLITE else "postgres",
        "persistent": not (config.IS_SQLITE and bool(__import__("os").getenv("VERCEL"))),
        "llm_enabled": config.llm_enabled(),
        "models": {"event": config.MODEL_EVENT, "explain": config.MODEL_EXPLAIN},
        "graph": g.stats(),
        "budget": {"spent_today_usd": round(llm.spent_today(), 4), "daily_budget_usd": config.DAILY_BUDGET_USD},
        "passcode_required": bool(config.DEMO_PASSCODE),
    }


class AnalyzeIn(BaseModel):
    headline: str = Field(min_length=8, max_length=600)
    passcode: str | None = None


def _llm_errors(fn):
    try:
        return fn()
    except llm.BudgetExceeded as e:
        raise HTTPException(429, str(e))
    except llm.LlmUnavailable as e:
        raise HTTPException(503, str(e))


@router.post("/analyze")
def analyze(body: AnalyzeIn, request: Request) -> dict:
    headline = " ".join(body.headline.split())
    cached = pipeline.find_cached(headline)
    if cached:
        return pipeline.run_json(cached)
    if config.DEMO_PASSCODE and body.passcode != config.DEMO_PASSCODE:
        raise HTTPException(401, "This demo needs a passcode for new headlines. Saved examples are open to all.")
    ip_hash = llm.hash_ip(client_ip(request))
    run = _llm_errors(lambda: pipeline.analyze(headline, ip_hash))
    return pipeline.run_json(run)


@router.post("/runs/{run_id}/explain")
def explain(run_id: str, request: Request) -> dict:
    ip_hash = llm.hash_ip(client_ip(request))
    try:
        run = _llm_errors(lambda: pipeline.explain(run_id, ip_hash))
    except KeyError:
        raise HTTPException(404, "Run not found")
    return pipeline.run_json(run)


@router.get("/runs/{run_id}")
def get_run(run_id: str) -> dict:
    with session() as s:
        run = s.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    return pipeline.run_json(run)


@router.get("/runs")
def list_runs(limit: int = 30) -> list[dict]:
    with session() as s:
        runs = s.scalars(select(Run).order_by(Run.is_demo.desc(), Run.created_at.desc()).limit(limit)).all()
    return [{"id": r.id, "headline": r.headline, "created_at": r.created_at.isoformat() + "Z",
             "is_demo": r.is_demo, "event_type": r.event.get("event_type"), "severity": r.event.get("severity"),
             "reached": r.result.get("stats", {}).get("reached", 0), "explained": bool(r.explanation)}
            for r in runs]


@router.get("/companies")
def search_companies(q: str = "", limit: int = 20) -> list[dict]:
    g = get_graph()
    deg = {}
    for e in g.edges.values():
        deg[e.src] = deg.get(e.src, 0) + 1
        deg[e.dst] = deg.get(e.dst, 0) + 1
    ql = q.lower().strip()
    rows = [n for n in g.nodes.values() if n["kind"] == "company" and n["in_universe"]
            and (not ql or ql in n["name"].lower() or (n["ticker"] or "").lower().startswith(ql)
                 or ql == n["id"].lower())]
    rows.sort(key=lambda n: (-(n["id"].lower() == ql), -deg.get(n["id"], 0)))
    return [{**n, "degree": deg.get(n["id"], 0)} for n in rows[:limit]]


@router.get("/companies/{node_id}")
def company(node_id: str) -> dict:
    g = get_graph()
    node = g.nodes.get(node_id)
    if node is None:
        raise HTTPException(404, "Unknown company")
    edges = [g.edge_json(e) for e in g.out.get(node_id, []) + g.inn.get(node_id, [])]
    neighbours = {e["src"] for e in edges} | {e["dst"] for e in edges}
    with session() as s:
        docs = s.scalars(select(Document).where(Document.node_id == node_id)).all()
    return {
        "node": node,
        "edges": edges,
        "nodes": [g.nodes[n] for n in neighbours if n in g.nodes],
        "documents": [{"form": d.form, "filed_at": d.filed_at.isoformat(), "url": d.url} for d in docs],
    }


@router.get("/graph/stats")
def graph_stats() -> dict:
    g = get_graph()
    sectors: dict[str, int] = {}
    for n in g.nodes.values():
        if n["kind"] == "company" and n["in_universe"]:
            sectors[n["sector"]] = sectors.get(n["sector"], 0) + 1
    return {**g.stats(), "sectors": sectors}


class Holding(BaseModel):
    ticker: str = Field(max_length=20)
    weight: float = Field(ge=0)


class PortfolioIn(BaseModel):
    run_id: str
    holdings: list[Holding] = Field(max_length=200)


def _etfs() -> dict:
    path = config.DATA / "etfs.json"
    return json.loads(path.read_text()) if path.exists() else {}


@router.get("/etfs")
def etfs() -> dict:
    return {k: {"name": v["name"], "as_of": v.get("as_of"), "holdings": len(v["holdings"])} for k, v in _etfs().items()}


@router.post("/portfolio/exposure")
def portfolio(body: PortfolioIn) -> dict:
    with session() as s:
        run = s.get(Run, body.run_id)
    if run is None:
        raise HTTPException(404, "Run not found")
    scores = run.result.get("all_scores", {})
    g = get_graph()
    resolver = Resolver()
    etf_map = _etfs()
    total_w = sum(h.weight for h in body.holdings) or 1.0
    rows = []
    for h in body.holdings:
        t = h.ticker.strip().upper()
        w = h.weight / total_w
        if t in etf_map:
            parts = etf_map[t]["holdings"]
            covered = {k: v for k, v in parts.items() if k in g.nodes}
            impact = sum(v * scores.get(k, [0])[0] for k, v in covered.items())
            top = sorted(((k, v * scores.get(k, [0])[0]) for k in covered), key=lambda kv: -abs(kv[1]))[:3]
            rows.append({"ticker": t, "weight": w, "kind": "etf", "name": etf_map[t]["name"], "impact": impact,
                         "hop": None, "status": "exposed" if impact else "no_known_path",
                         "coverage": round(sum(covered.values()), 3),
                         "drivers": [{"id": k, "contribution": round(c, 4)} for k, c in top if c]})
            continue
        m = resolver.resolve(t)
        node_id = m.node_id if m.node_id in g.nodes else None
        if node_id is None:
            rows.append({"ticker": t, "weight": w, "kind": "unknown", "name": None, "impact": None, "hop": None,
                         "status": "not_in_graph"})
            continue
        sc = scores.get(node_id)
        n = g.nodes[node_id]
        rows.append({"ticker": t, "id": node_id, "weight": w, "kind": "company", "name": n["name"],
                     "coverage": n["coverage"], "impact": sc[0] if sc else 0.0, "hop": sc[1] if sc else None,
                     "status": "exposed" if sc else "no_known_path"})
    weighted = sum(r["weight"] * (r["impact"] or 0) for r in rows)
    return {
        "run_id": run.id,
        "headline": run.headline,
        "rows": sorted(rows, key=lambda r: -abs((r["impact"] or 0) * r["weight"])),
        "weighted_impact": round(weighted, 4),
        "exposed": sum(1 for r in rows if r["status"] == "exposed"),
        "holdings": len(rows),
        "unknown_weight": round(sum(r["weight"] for r in rows if r["status"] == "not_in_graph"), 4),
    }


@router.get("/backtests")
def backtests() -> list[dict]:
    with session() as s:
        return [b.data for b in s.scalars(select(Backtest)).all()]


_news_cache: tuple[float, list] | None = None


@router.get("/news")
def news() -> list[dict]:
    """Recent supply-chain headlines from GDELT (free, no key), cached for 15 minutes."""
    global _news_cache
    if _news_cache and time.time() - _news_cache[0] < 900:
        return _news_cache[1]
    query = ('(semiconductor OR chipmaker OR foundry OR automaker OR "supply chain" OR "chip shortage") '
             "sourcelang:english")
    try:
        resp = httpx.get("https://api.gdeltproject.org/api/v2/doc/doc",
                         params={"query": query, "mode": "artlist", "maxrecords": 40, "format": "json",
                                 "sort": "datedesc", "timespan": "2d"}, timeout=8)
        arts = resp.json().get("articles", [])
    except Exception:
        return _news_cache[1] if _news_cache else []
    seen, items = set(), []
    for a in arts:
        title = " ".join(a.get("title", "").split())
        key = title.lower()[:60]
        if len(title) < 25 or key in seen:
            continue
        seen.add(key)
        items.append({"title": title, "url": a.get("url"), "domain": a.get("domain"), "seen": a.get("seendate")})
    _news_cache = (time.time(), items[:20])
    return _news_cache[1]


def _admin(token: str | None) -> None:
    if not config.ADMIN_TOKEN or token != config.ADMIN_TOKEN:
        raise HTTPException(401, "Admin token required")


@router.get("/review")
def review_queue(request: Request) -> dict:
    _admin(request.headers.get("x-admin-token"))
    g = get_graph()
    with session() as s:
        rejected = s.scalars(select(Edge).where(Edge.status == "rejected")).all()
        unresolved = s.scalars(select(Unresolved).order_by(Unresolved.count.desc()).limit(60)).all()
    flagged = [g.edge_json(e) for e in g.edges.values() if e.quality()[0] == "speculative"]
    flagged.sort(key=lambda e: (-e["strength"], e["src"]))
    return {
        "flagged": flagged[:200],
        "rejected": [{"id": e.id, "src": e.src, "dst": e.dst, "rel": e.rel} for e in rejected],
        "unresolved": [{"raw": u.raw, "count": u.count, "example": u.example} for u in unresolved],
        "nodes": {n: g.nodes[n]["name"] for e in flagged[:200] for n in (e["src"], e["dst"])},
    }


class ReviewIn(BaseModel):
    action: str = Field(pattern="^(reject|restore)$")


@router.post("/review/{edge_id}")
def review(edge_id: int, body: ReviewIn, request: Request) -> dict:
    _admin(request.headers.get("x-admin-token"))
    with session() as s:
        e = s.get(Edge, edge_id)
        if e is None:
            raise HTTPException(404, "Edge not found")
        key = f"{e.src}|{e.rel}|{e.dst}"
        if body.action == "reject":
            e.status = "rejected"
            s.merge(ReviewDecision(key=key, status="rejected"))
        else:
            e.status = "curated" if e.strength_source == "curated" else "verified"
            d = s.get(ReviewDecision, key)
            if d:
                s.delete(d)
        s.commit()
    invalidate()
    return {"ok": True, "edge_id": edge_id, "action": body.action}


@router.get("/nodes")
def all_nodes(kind: str = "company") -> list[dict]:
    with session() as s:
        rows = s.scalars(select(Node).where(Node.kind == kind, or_(Node.in_universe.is_(True)))).all()
    return [{"id": n.id, "name": n.name, "ticker": n.ticker, "sector": n.sector} for n in rows]


app.include_router(router)
