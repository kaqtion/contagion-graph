"""MCP server: exposes the contagion graph to any MCP client (Claude Desktop, the MCP Inspector, ...) over stdio.

    python -m contagion.mcp_server

Tools reuse the web app's pipeline unchanged. The server's own queries go through a read-only connection, so it
never changes the graph; the only writes are the ones the pipeline already makes to respect the cache and the
daily AI budget (a cached run per new headline, its explanation, and the LLM spend log).
"""
from __future__ import annotations

import sqlite3
from functools import cache
from pathlib import Path
from typing import Annotated, Any, Literal

import anthropic
import anyio
from mcp.server import MCPServer
from mcp.server.mcpserver.exceptions import ResourceNotFoundError, ToolError
from mcp.types import ToolAnnotations
from pydantic import BaseModel, Field
from rapidfuzz import fuzz, process
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool

from . import config, llm, pipeline
from .agents import navigator, scorer
from .db import Document, Run, select
from .graph import Graph, get_graph

# MCP clients share one bucket for the per-client hourly limit; the daily budget is global as before.
MCP_CLIENT = llm.hash_ip("mcp-stdio")
MIN_HEADLINE = 8
REL_TEXT = {"supplies_to": "supplies", "competes_with": "competes with", "operates_in": "operates in",
            "depends_on": "depends on", "produces": "produces"}
Category = Literal["suppliers", "customers", "competitors", "regions", "commodities"]


# ---------------------------------------------------------------------------------------------------------------
# Read-only database access


@cache
def _readonly_sessions() -> sessionmaker[Session]:
    if config.IS_SQLITE:
        uri = Path(make_url(config.DATABASE_URL).database or "").resolve().as_uri() + "?mode=ro"
        engine = create_engine("sqlite://", poolclass=NullPool,
                               creator=lambda: sqlite3.connect(uri, uri=True, check_same_thread=False))
    else:
        engine = create_engine(config.DATABASE_URL, poolclass=NullPool, connect_args={"prepare_threshold": None})

        # a per-transaction setting, so it also works through Neon's transaction-mode pooler
        @event.listens_for(engine, "begin")
        def _read_only(conn) -> None:
            conn.exec_driver_sql("SET TRANSACTION READ ONLY")
    return sessionmaker(engine, expire_on_commit=False)


def ro_session() -> Session:
    return _readonly_sessions()()


# ---------------------------------------------------------------------------------------------------------------
# Output models (become each tool's output schema)


class Citation(BaseModel):
    evidence_id: int
    quote: str = Field(description="Verbatim sentence from the filing")
    source: str | None = Field(None, description="Filer, form and filing date")
    url: str | None = None
    as_of: str | None = None


class Link(BaseModel):
    edge_id: int
    statement: str = Field(description='Plain-English link, e.g. "TSMC supplies Nvidia"')
    category: Category | None = Field(None, description="Set by get_company_links: the link as seen from the company")
    source_id: str
    source_name: str
    relation: str
    target_id: str
    target_name: str
    tier: str
    strength: float
    strength_basis: str = Field(description="disclosed % / tier / curated")
    status: str = Field(description="verified = backed by a filing quote; curated = hand-entered, no quote")
    quality: Literal["verified", "speculative"]
    quality_reasons: list[str]
    as_of: str | None
    note: str | None = None
    citations: list[Citation]


class PathOut(BaseModel):
    index: int
    chain: str = Field(description="Origin to company, e.g. TSMC -> Credo")
    contribution: float = Field(description="This path's share of the company's impact score")
    quality: Literal["verified", "speculative"]
    quality_reasons: list[str]
    math: dict[str, Any]
    links: list[Link]


class CompanyInfo(BaseModel):
    id: str
    ticker: str | None
    name: str
    sector: str | None = None
    country: str | None = None
    coverage: str | None = Field(None, description="How much of the company's network is backed by filings")
    in_universe: bool = True


class Exposure(CompanyInfo):
    rank: int
    impact: float = Field(description="Negative = hurt, positive = helped")
    direction: Literal["hurt", "helped"]
    hop: int
    quality: Literal["verified", "speculative"]
    path_count: int
    paths: list[PathOut]


class TraceResult(BaseModel):
    run_id: str = Field(description="Pass to explain_path")
    headline: str
    cached: bool = Field(description="True when the headline was already traced (no AI cost)")
    ai_cost_usd: float
    max_hops: int
    event: dict[str, Any]
    origins: list[dict[str, Any]]
    unresolved_origins: list[str]
    stats: dict[str, Any]
    note: str | None
    explanation_summary: str | None
    companies: list[Exposure]


class CompanyLinks(BaseModel):
    company: CompanyInfo
    relation: Category | None
    counts: dict[str, int]
    links: list[Link]


class Claim(BaseModel):
    text: str
    supported: bool | None = Field(description="Critic verdict: does the cited quote support the claim?")
    issue: str | None
    on_this_path: bool = Field(description="True when the claim cites evidence from this path's links")
    citations: list[Citation]


class PathExplanation(BaseModel):
    run_id: str
    headline: str
    company: Exposure
    path: PathOut
    rationale: str | None
    claims: list[Claim]
    critic: dict[str, int] | None = Field(description="Claims checked and supported, for the whole run")
    note: str | None


class Example(BaseModel):
    run_id: str
    headline: str
    event_type: str
    severity: int
    companies_reached: int
    hurt: int
    helped: int
    explained: bool
    top_companies: list[str]


class Examples(BaseModel):
    examples: list[Example]
    note: str


# ---------------------------------------------------------------------------------------------------------------
# Helpers


class UnknownCompany(LookupError):
    pass


def find_company(g: Graph, ticker: str) -> dict:
    """Ticker, node id or external id -> company node. Raises UnknownCompany with suggestions."""
    t = (ticker or "").strip()
    if not t:
        raise UnknownCompany("ticker is empty. Pass a ticker such as NVDA or TSM.")
    node = g.nodes.get(t) or g.nodes.get(t.upper())
    if node is None:
        node = next((n for n in g.nodes.values() if n["kind"] == "company" and (n["ticker"] or "").upper() == t.upper()),
                    None)
    if node is None or node["kind"] != "company":
        names = {n["id"]: f'{n["ticker"] or n["id"]} {n["name"]}' for n in g.nodes.values()
                 if n["kind"] == "company" and n["in_universe"]}
        hits = process.extract(t, names, scorer=fuzz.WRatio, limit=3)
        hint = f" Did you mean: {', '.join(h[0] for h in hits)}?" if hits else ""
        raise UnknownCompany(f"Unknown ticker '{t}'.{hint}")
    return node


def _info(node: dict) -> dict:
    return {k: node.get(k) for k in ("id", "ticker", "name", "sector", "country", "coverage", "in_universe")}


def _citations(edge: dict, g: Graph) -> list[Citation]:
    evidence = edge.get("evidence")
    if evidence is None:
        evidence = [g.evidence[i] for i in edge.get("evidence_ids", []) if i in g.evidence]
    return [Citation(evidence_id=e["id"], quote=e["quote"], source=e.get("source"), url=e.get("url"),
                     as_of=e.get("as_of")) for e in evidence]


def _name(g: Graph, node_id: str, fallback: dict | None = None) -> str:
    n = g.nodes.get(node_id) or (fallback or {}).get(node_id)
    return n["name"] if n else node_id


def _link(g: Graph, edge: dict, category: Category | None = None, run_nodes: dict | None = None) -> Link:
    src, dst = _name(g, edge["src"], run_nodes), _name(g, edge["dst"], run_nodes)
    return Link(edge_id=edge["id"], statement=f"{src} {REL_TEXT.get(edge['rel'], edge['rel'])} {dst}",
                category=category, source_id=edge["src"], source_name=src, relation=edge["rel"],
                target_id=edge["dst"], target_name=dst, tier=edge["tier"], strength=edge["strength"],
                strength_basis=edge["strength_source"], status=edge["status"], quality=edge["quality"],
                quality_reasons=edge["quality_reasons"], as_of=edge["as_of"], note=edge.get("note"),
                citations=_citations(edge, g))


def _edge(g: Graph, edge_id: int, run_edges: dict[int, dict]) -> dict | None:
    """The edge as stored with the run (what that trace used), else as it is in the current graph."""
    if edge_id in run_edges:
        return run_edges[edge_id]
    return g.edge_json(g.edges[edge_id]) if edge_id in g.edges else None


def _path(g: Graph, p: dict, index: int, run_edges: dict[int, dict], run_nodes: dict) -> PathOut:
    links = [_link(g, e, run_nodes=run_nodes) for st in p["steps"] if (e := _edge(g, st["edge_id"], run_edges))]
    return PathOut(index=index, chain=" -> ".join(_name(g, n, run_nodes) for n in p["nodes"]),
                   contribution=p["contribution"], quality=p["quality"], quality_reasons=p["quality_reasons"],
                   math=p["math"], links=links)


def _exposure(g: Graph, row: dict, rank: int, run_edges: dict, run_nodes: dict, max_paths: int) -> Exposure:
    node = g.nodes.get(row["id"]) or run_nodes.get(row["id"]) or {"id": row["id"], "name": row["id"]}
    return Exposure(**{**_info(node), "in_universe": bool(node.get("in_universe", True))}, rank=rank,
                    impact=row["impact"], direction="hurt" if row["impact"] < 0 else "helped", hop=row["hop"],
                    quality=row["quality"], path_count=row["path_count"],
                    paths=[_path(g, p, i, run_edges, run_nodes) for i, p in enumerate(row["paths"][:max_paths])])


def _run_maps(result: dict) -> tuple[dict[int, dict], dict[str, dict]]:
    graph = result.get("graph", {})
    return {e["id"]: e for e in graph.get("edges", [])}, {n["id"]: n for n in graph.get("nodes", [])}


def _trace_limited(g: Graph, event_: dict, max_hops: int) -> dict:
    """The deterministic trace with paths capped at max_hops (same navigator and scorer as the pipeline)."""
    origins, unresolved = pipeline.resolve_origins(g, event_)
    polarity = -1 if event_["polarity"] == "negative" else 1
    paths = [p for p in navigator.find_paths(g, origins, event_["event_type"]) if len(p.steps) <= max_hops]
    rows = scorer.score(g, paths, origins, event_["severity"], polarity)
    reached = [r for r in rows if not r["is_origin"]]
    by_hop: dict[int, int] = {}
    for r in rows:
        by_hop[r["hop"]] = by_hop.get(r["hop"], 0) + 1
    return {
        "origins": [{"id": o, "name": g.nodes[o]["name"], "kind": g.nodes[o]["kind"]} for o in origins],
        "unresolved_origins": unresolved, "exposures": rows[:pipeline.TOP_N], "graph": {},
        "stats": {"paths": len(paths), "reached": len(reached), "by_hop": by_hop,
                  "hurt": sum(1 for r in reached if r["impact"] < 0),
                  "helped": sum(1 for r in reached if r["impact"] > 0)},
        "note": None,
    }


def _ai_error(e: Exception) -> ToolError:
    if isinstance(e, llm.BudgetExceeded):
        return ToolError(str(e))
    if isinstance(e, llm.LlmUnavailable):
        return ToolError(f"The AI step is unavailable ({e}). Set ANTHROPIC_API_KEY in .env.local, or use "
                         "list_examples for traces that are already stored.")
    return ToolError(f"The AI call failed ({type(e).__name__}). Try again shortly.")


AI_ERRORS = (llm.BudgetExceeded, llm.LlmUnavailable, anthropic.APIError)


# ---------------------------------------------------------------------------------------------------------------
# Server

mcp = MCPServer(
    "Contagion Graph",
    instructions=(
        "Contagion Graph traces a news event through a graph of supplier, customer, competitor, region and "
        "commodity links built from SEC filings, and scores which companies are hurt or helped. Every link carries "
        "the verbatim filing quote behind it; cite those quotes. Links marked curated or speculative have no quote "
        "or are stale or weak: say so. Scores describe exposure through known links, not price predictions."
    ),
)

READ_ONLY = ToolAnnotations(read_only_hint=True, open_world_hint=False)
USES_AI = ToolAnnotations(read_only_hint=False, destructive_hint=False, idempotent_hint=True, open_world_hint=True)


@mcp.tool(annotations=USES_AI)
async def trace_headline(
    headline: Annotated[str, Field(max_length=600, description="A news headline, e.g. 'Fire halts Renesas Naka plant'")],
    max_hops: Annotated[int, Field(ge=1, le=3, description="How far the shock may travel (1-3 links)")] = 3,
    limit: Annotated[int, Field(ge=1, le=60, description="How many companies to return")] = 15,
    paths_per_company: Annotated[int, Field(ge=1, le=5, description="Strongest paths returned per company")] = 2,
) -> TraceResult:
    """Trace a headline through the graph: ranked companies with impact scores, the paths that reach them and the
    filing quotes behind every link. Headlines already traced are served from the cache at no cost; a new one makes
    one small AI call, within the daily AI budget."""
    text = headline.strip()
    if len(text) < MIN_HEADLINE:
        raise ToolError(f"headline is empty or too short (need at least {MIN_HEADLINE} characters).")
    cached = pipeline.find_cached(text) is not None
    try:
        run = await anyio.to_thread.run_sync(lambda: pipeline.analyze(text, ip_hash=MCP_CLIENT))
    except AI_ERRORS as e:
        raise _ai_error(e) from e

    g = get_graph()
    # the stored run is the full trace; a shorter reach is re-scored from the same event, which is free
    result = run.result if max_hops >= 3 else {**_trace_limited(g, run.event, max_hops), "note": run.result.get("note")}
    run_edges, run_nodes = _run_maps(run.result)
    rows = [r for r in result["exposures"] if not r["is_origin"]][:limit]
    return TraceResult(
        run_id=run.id, headline=run.headline, cached=cached, ai_cost_usd=0.0 if cached else round(run.cost_usd or 0, 5),
        max_hops=max_hops, event=run.event, origins=result["origins"],
        unresolved_origins=result["unresolved_origins"], stats=result["stats"], note=result.get("note"),
        explanation_summary=(run.explanation or {}).get("summary"),
        companies=[_exposure(g, r, i + 1, run_edges, run_nodes, paths_per_company) for i, r in enumerate(rows)],
    )


@mcp.tool(annotations=READ_ONLY)
def get_company_links(
    ticker: Annotated[str, Field(max_length=80, description="Ticker or node id, e.g. NVDA, TSM, AAPL")],
    relation: Annotated[Category | None, Field(description="Only this kind of link; omit for all")] = None,
    limit: Annotated[int, Field(ge=1, le=200, description="Maximum links returned, strongest first")] = 50,
) -> CompanyLinks:
    """A company's suppliers, customers, competitors, regions and commodities, each with the filing quotes behind
    the link. Reads the database only; no AI call."""
    g = get_graph()
    try:
        node = find_company(g, ticker)
    except UnknownCompany as e:
        raise ToolError(str(e)) from e
    nid = node["id"]
    links: list[Link] = []
    counts = {c: 0 for c in ("suppliers", "customers", "competitors", "regions", "commodities")}
    for e in g.out.get(nid, []) + g.inn.get(nid, []):
        if e.rel == "supplies_to":
            cat: Category = "customers" if e.src == nid else "suppliers"
        elif e.rel == "competes_with":
            cat = "competitors"
        elif e.rel == "operates_in":
            cat = "regions"
        else:
            cat = "commodities"
        counts[cat] += 1
        if relation is None or relation == cat:
            links.append(_link(g, g.edge_json(e), cat))
    links.sort(key=lambda link: (link.quality != "verified", -link.strength))
    return CompanyLinks(company=CompanyInfo(**_info(node)), relation=relation, counts=counts, links=links[:limit])


@mcp.tool(annotations=USES_AI)
async def explain_path(
    run_id: Annotated[str, Field(min_length=1, max_length=40, description="run_id from trace_headline or list_examples")],
    ticker: Annotated[str, Field(max_length=80, description="A company reached by that run")],
    path_index: Annotated[int, Field(ge=0, le=4, description="0 = strongest path")] = 0,
    generate_if_missing: Annotated[bool, Field(description="Write the explanation now if the run has none "
                                                           "(two small AI calls, within the daily budget)")] = True,
) -> PathExplanation:
    """One path from a traced event to a company, with the filing quote for every link, the written rationale and
    the critic's verdict on each claim."""
    run_id = run_id.strip()
    with ro_session() as s:
        run = s.get(Run, run_id)
    if run is None:
        raise ToolError(f"Unknown run_id '{run_id}'. Use list_examples or trace_headline to get one.")
    g = get_graph()
    try:
        node_id = find_company(g, ticker)["id"]
    except UnknownCompany as e:
        raise ToolError(str(e)) from e
    rows = {r["id"]: r for r in run.result["exposures"] if not r["is_origin"]}
    row = rows.get(node_id)
    if row is None:
        top = ", ".join((g.nodes.get(i) or {}).get("ticker") or i for i in list(rows)[:8])
        raise ToolError(f"'{ticker}' is not among the companies this run reached. Top companies: {top}.")
    if path_index >= len(row["paths"]):
        raise ToolError(f"path_index {path_index} is out of range: this company has {len(row['paths'])} stored "
                        "path(s), numbered from 0.")

    note = None
    if not run.explanation and generate_if_missing:
        try:
            run = await anyio.to_thread.run_sync(lambda: pipeline.explain(run_id, ip_hash=MCP_CLIENT))
        except AI_ERRORS as e:
            note = f"No explanation yet: {_ai_error(e)}. The path and its quotes below are complete."
    elif not run.explanation:
        note = "This run has no explanation yet; call again with generate_if_missing=true to write one."

    run_edges, run_nodes = _run_maps(run.result)
    rank = list(rows).index(node_id) + 1
    company = _exposure(g, row, rank, run_edges, run_nodes, max_paths=5)
    path = company.paths[path_index]
    path_evidence = {c.evidence_id for link in path.links for c in link.citations}
    expl = next((c for c in (run.explanation or {}).get("companies", []) if c["id"] == node_id), None)
    if run.explanation and expl is None:
        note = "The explanation covers the top ten companies only; this one has paths and quotes but no rationale."
    claims = [
        Claim(text=cl["text"], supported=cl.get("supported"), issue=cl.get("issue") or None,
              on_this_path=bool(set(cl["evidence_ids"]) & path_evidence),
              citations=[Citation(evidence_id=e, quote=g.evidence[e]["quote"], source=g.evidence[e]["source"],
                                  url=g.evidence[e]["url"], as_of=g.evidence[e]["as_of"])
                         for e in cl["evidence_ids"] if e in g.evidence])
        for cl in (expl or {}).get("claims", [])
    ]
    return PathExplanation(run_id=run.id, headline=run.headline, company=company, path=path,
                           rationale=(expl or {}).get("rationale"), claims=claims,
                           critic=(run.explanation or {}).get("critic"), note=note)


@mcp.tool(annotations=READ_ONLY)
def list_examples() -> Examples:
    """The stored worked examples: real-world shocks already traced and explained. Opening them costs nothing."""
    with ro_session() as s:
        runs = s.scalars(select(Run).where(Run.is_demo.is_(True)).order_by(Run.created_at)).all()
    g = get_graph()
    out = []
    for r in runs:
        stats = r.result.get("stats", {})
        top = [x for x in r.result.get("exposures", []) if not x["is_origin"]][:5]
        out.append(Example(
            run_id=r.id, headline=r.headline, event_type=r.event.get("event_type", ""),
            severity=r.event.get("severity", 0), companies_reached=stats.get("reached", 0),
            hurt=stats.get("hurt", 0), helped=stats.get("helped", 0), explained=bool(r.explanation),
            top_companies=[f'{(g.nodes.get(x["id"]) or {}).get("ticker") or x["id"]} {x["impact"]:+.3f}' for x in top],
        ))
    return Examples(examples=out, note="Pass a run_id to explain_path, or the headline to trace_headline (cached, free).")


@mcp.resource("company://{ticker}", mime_type="application/json")
def company_profile(ticker: str) -> dict:
    """A company's profile: sector, country, graph coverage, link counts, its strongest links and its filings."""
    g = get_graph()
    try:
        node = find_company(g, ticker)
    except UnknownCompany as e:
        raise ResourceNotFoundError(str(e)) from e
    links = get_company_links(node["id"], limit=200)
    with ro_session() as s:
        docs = s.scalars(select(Document).where(Document.node_id == node["id"])).all()
    strongest: dict[str, list[str]] = {}
    for link in links.links:
        other = link.target_name if link.source_id == node["id"] else link.source_name
        bucket = strongest.setdefault(link.category or "other", [])
        if len(bucket) < 8:
            bucket.append(f"{other} ({link.tier}, {link.quality})")
    return {
        **_info(node),
        "link_counts": links.counts,
        "strongest_links": strongest,
        "filings": [{"form": d.form, "filed_at": d.filed_at.isoformat(), "url": d.url} for d in docs],
        "tools": "Use get_company_links for every link with its filing quotes.",
    }


@mcp.prompt(title="Assess a headline's exposure")
def assess_headline_exposure(
    headline: Annotated[str, Field(description="The news headline to assess")],
    holdings: Annotated[str, Field(description="Optional tickers to focus on, e.g. 'NVDA, AAPL, SOXX'")] = "",
) -> str:
    """Assess which companies a headline hurts or helps, with cited evidence."""
    focus = (f"\nPay particular attention to these holdings: {holdings}. Say plainly which of them have no known "
             "path from the event (that means no known link, not proof of no exposure).") if holdings.strip() else ""
    return (
        f'Assess the supply-chain exposure to this headline: "{headline}"\n\n'
        "1. Call trace_headline with the headline.\n"
        "2. For the five most exposed companies, call explain_path to get the strongest path and the critic's verdicts.\n"
        "3. Write a short brief: where the impact concentrates, then for each company the chain of links, the impact "
        "score and direction, and the verbatim filing quote behind each link, cited by its source.\n"
        "4. Flag links that are curated, stale, weak or that the critic did not support.\n"
        "5. Note anything named in the headline that the graph does not cover (unresolved_origins)."
        f"{focus}\n\nScores describe exposure through known links, not price predictions. Do not give buy or sell advice."
    )


def main() -> None:
    mcp.run()


if __name__ == "__main__":
    main()
