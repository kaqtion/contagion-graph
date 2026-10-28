"""Impact scorer: deterministic Python, no LLM arithmetic.

    Impact(c) = S_e * polarity * sum over paths p from origin to c of
                (prod over edges of w_uv * s_uv) * lambda^(|p|-1) * f_fresh(p)

S_e is severity scaled to 0-1, polarity is -1 for bad events, s_uv is -1 on competitor/producer edges,
lambda is the hop decay and f_fresh is the freshness of the path's oldest edge.
"""
from __future__ import annotations

from collections import defaultdict

from .. import config
from ..graph import Graph
from .navigator import Path


def path_contribution(g: Graph, p: Path, severity: int, polarity: int) -> dict:
    s_e = severity / 5
    weight = 1.0
    terms = []
    fresh = 1.0
    quality = "verified"
    reasons: list[str] = []
    for st in p.steps:
        e = g.edges[st.edge_id]
        weight *= st.w * st.sign
        terms.append({"w": round(st.w, 3), "s": st.sign})
        fresh = min(fresh, e.freshness())
        q, r = e.quality()
        if q == "speculative":
            quality = "speculative"
            reasons.extend(f"{g.nodes[e.src]['name']} -> {g.nodes[e.dst]['name']}: {x}" for x in r)
    decay = config.HOP_DECAY ** (len(p.steps) - 1)
    value = s_e * polarity * weight * decay * fresh
    return {
        "origin": p.origin,
        "nodes": [p.origin] + [s.to for s in p.steps],
        "steps": [{"edge_id": s.edge_id, "from": s.frm, "to": s.to, "kind": s.kind} for s in p.steps],
        "contribution": round(value, 4),
        "math": {"severity": round(s_e, 2), "polarity": polarity, "terms": terms, "decay": round(decay, 3),
                 "freshness": round(fresh, 3)},
        "quality": quality,
        "quality_reasons": reasons,
    }


def score(g: Graph, paths: list[Path], origins: list[str], severity: int, polarity: int) -> list[dict]:
    by_node: dict[str, list[dict]] = defaultdict(list)
    for p in paths:
        by_node[p.end].append(path_contribution(g, p, severity, polarity))
    rows = []
    for o in origins:
        if g.nodes[o]["kind"] == "company":
            rows.append({"id": o, "impact": round(severity / 5 * polarity, 4), "hop": 0, "paths": [],
                         "path_count": 0, "quality": "verified", "is_origin": True})
    for node, contribs in by_node.items():
        if node in origins:
            continue
        contribs.sort(key=lambda c: -abs(c["contribution"]))
        impact = sum(c["contribution"] for c in contribs)
        top = contribs[:5]
        rows.append({
            "id": node,
            "impact": round(impact, 4),
            "hop": min(len(c["steps"]) for c in contribs),
            "paths": top,
            "path_count": len(contribs),
            "quality": "verified" if any(c["quality"] == "verified" for c in top) else "speculative",
            "is_origin": False,
        })
    rows.sort(key=lambda r: (not r["is_origin"], -abs(r["impact"])))
    return rows
