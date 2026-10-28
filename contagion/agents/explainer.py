"""Explainer agent (GraphRAG): writes plain-English rationale for the top exposures, citing the source
quote of every edge on the path. Evidence is retrieved by edge id, so no claim needs a similarity search."""
from __future__ import annotations

from .. import config, llm
from ..graph import Graph

SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "companies": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string"},
                    "rationale": {"type": "string"},
                    "claims": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "text": {"type": "string"},
                                "evidence_ids": {"type": "array", "items": {"type": "integer"}},
                            },
                            "required": ["text", "evidence_ids"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["id", "rationale", "claims"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "companies"],
    "additionalProperties": False,
}

SYSTEM = """You explain how a news event propagates through a company relationship graph to specific companies.

You get the event and, for each company, its strongest paths. Every edge on a path comes with evidence quotes tagged [E<id>], or is marked CURATED (no quote available).

Write for an analyst:
- summary: 2-3 sentences on where the impact concentrates, mentioning the strongest second-order effects.
- For each company: rationale of 1-2 sentences naming the chain (e.g. "TSMC is Nvidia's sole foundry, so..."), and the impact direction (hurt or helped).
- claims: break the rationale into factual relationship claims. Each claim cites the evidence ids that support it. A claim about a CURATED edge cites [] and must say the link is reported but not quoted from a filing.
- Use only the evidence given. Do not add relationships, numbers or predictions that are not in the evidence. No buy or sell recommendations."""


def _describe_path(g: Graph, path: dict) -> str:
    parts = []
    for st in path["steps"]:
        e = g.edges.get(st["edge_id"])
        if e is None:
            continue
        a, b = g.nodes[e.src]["name"], g.nodes[e.dst]["name"]
        rel = {"supplies_to": f"{a} supplies {b}", "competes_with": f"{a} competes with {b}",
               "operates_in": f"{a} operates in {b}", "depends_on": f"{a} depends on {b}",
               "produces": f"{a} produces {b}"}[e.rel]
        if e.evidence_ids:
            quotes = " ".join(f'[E{i}] "{g.evidence[i]["quote"][:300]}" ({g.evidence[i]["source"]})'
                              for i in e.evidence_ids[:2] if i in g.evidence)
            parts.append(f"  - {rel} ({e.tier}). {quotes}")
        else:
            parts.append(f"  - {rel} ({e.tier}). CURATED: {e.note or 'no quote'}")
    return "\n".join(parts)


def build_prompt(g: Graph, event: dict, rows: list[dict], top_n: int = 10) -> tuple[str, list[dict]]:
    chosen = [r for r in rows if not r["is_origin"]][:top_n]
    blocks = []
    for r in chosen:
        name = g.nodes[r["id"]]["name"]
        direction = "hurt" if r["impact"] < 0 else "helped"
        paths = "\n".join(f" Path {i + 1} (contribution {p['contribution']:+.3f}):\n{_describe_path(g, p)}"
                          for i, p in enumerate(r["paths"][:2]))
        blocks.append(f"Company id={r['id']} ({name}), {direction}, impact {r['impact']:+.3f}, hop {r['hop']}\n{paths}")
    user = (f"Event: {event['summary']} (type {event['event_type']}, severity {event['severity']}/5, "
            f"{event['polarity']})\n\n" + "\n\n".join(blocks))
    return user, chosen


def explain(g: Graph, event: dict, rows: list[dict], ip_hash: str | None = None) -> tuple[dict, float]:
    user, chosen = build_prompt(g, event, rows)
    if not chosen:
        return {"summary": "No exposed companies were found in the graph for this event.", "companies": []}, 0.0
    return llm.json_call(purpose="explain", model=config.MODEL_EXPLAIN, system=SYSTEM, user=user, schema=SCHEMA,
                         max_tokens=6000, ip_hash=ip_hash)
