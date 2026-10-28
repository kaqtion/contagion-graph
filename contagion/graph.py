"""In-memory view of the relationship graph, loaded from the database and cached per process.

The graph is small (hundreds of nodes, a few thousand edges), so traversal in Python is fast and avoids
running a separate graph database.
"""
from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date

from . import config
from .db import Edge, EdgeEvidence, Evidence, Node, select, session


@dataclass
class GEdge:
    id: int
    src: str
    dst: str
    rel: str
    strength: float
    tier: str
    pct: float | None
    source: str
    status: str
    as_of: date | None
    note: str | None
    evidence_ids: list[int] = field(default_factory=list)

    def age_months(self, today: date | None = None) -> float | None:
        if not self.as_of:
            return None
        today = today or date.today()
        return (today - self.as_of).days / 30.44

    def freshness(self, today: date | None = None) -> float:
        age = self.age_months(today)
        if age is None or age <= config.FRESH_MONTHS:
            return 1.0
        return 0.5 ** ((age - config.FRESH_MONTHS) / 12)

    def quality(self, today: date | None = None) -> tuple[str, list[str]]:
        """'verified' or 'speculative' plus the reasons, as the critic reports them."""
        reasons = []
        if self.status == "curated" or not self.evidence_ids:
            reasons.append("no filing quote (curated)")
        age = self.age_months(today)
        if age is not None and age > config.STALE_MONTHS:
            reasons.append(f"evidence {age:.0f} months old")
        if self.strength < 0.3:
            reasons.append("weak link")
        return ("speculative" if reasons else "verified"), reasons


class Graph:
    def __init__(self) -> None:
        with session() as s:
            nodes = s.scalars(select(Node)).all()
            edges = s.scalars(select(Edge).where(Edge.status != "rejected")).all()
            links = s.execute(select(EdgeEvidence.edge_id, EdgeEvidence.evidence_id)).all()
            evidence = s.scalars(select(Evidence)).all()
        self.nodes = {
            n.id: {"id": n.id, "kind": n.kind, "name": n.name, "ticker": n.ticker, "sector": n.sector,
                   "country": n.country, "in_universe": n.in_universe, "coverage": n.coverage}
            for n in nodes
        }
        ev_by_edge: dict[int, list[int]] = defaultdict(list)
        for edge_id, ev_id in links:
            ev_by_edge[edge_id].append(ev_id)
        self.evidence = {
            e.id: {"id": e.id, "quote": e.quote, "source": e.source_label, "url": e.url,
                   "as_of": e.as_of.isoformat() if e.as_of else None}
            for e in evidence
        }
        self.edges: dict[int, GEdge] = {}
        self.out: dict[str, list[GEdge]] = defaultdict(list)
        self.inn: dict[str, list[GEdge]] = defaultdict(list)
        for e in edges:
            g = GEdge(e.id, e.src, e.dst, e.rel, e.strength, e.tier, e.pct, e.strength_source, e.status, e.as_of,
                      e.note, sorted(ev_by_edge.get(e.id, [])))
            self.edges[g.id] = g
            self.out[g.src].append(g)
            self.inn[g.dst].append(g)

    def stats(self) -> dict:
        companies = [n for n in self.nodes.values() if n["kind"] == "company"]
        return {
            "companies": sum(1 for n in companies if n["in_universe"]),
            "external_companies": sum(1 for n in companies if not n["in_universe"]),
            "edges": len(self.edges),
            "verified_edges": sum(1 for e in self.edges.values() if e.status == "verified"),
            "curated_edges": sum(1 for e in self.edges.values() if e.status == "curated"),
            "evidence_quotes": len(self.evidence),
        }

    def edge_json(self, e: GEdge, with_evidence: bool = True) -> dict:
        quality, reasons = e.quality()
        d = {"id": e.id, "src": e.src, "dst": e.dst, "rel": e.rel, "strength": e.strength, "tier": e.tier,
             "pct": e.pct, "strength_source": e.source, "status": e.status,
             "as_of": e.as_of.isoformat() if e.as_of else None, "note": e.note, "quality": quality,
             "quality_reasons": reasons, "evidence_ids": e.evidence_ids}
        if with_evidence:
            d["evidence"] = [self.evidence[i] for i in e.evidence_ids if i in self.evidence][:3]
        return d


_cache: tuple[float, Graph] | None = None


def get_graph(max_age_s: float = 300) -> Graph:
    global _cache
    if _cache is None or time.time() - _cache[0] > max_age_s:
        _cache = (time.time(), Graph())
    return _cache[1]


def invalidate() -> None:
    global _cache
    _cache = None
