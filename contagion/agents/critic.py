"""Critic agent: checks every explanation claim against the evidence it cites, before output.

Two layers: deterministic edge checks (quote present, age, strength; see GEdge.quality) and an LLM judge
that marks each claim supported or not by its cited quotes. Unsupported claims are flagged, not hidden.
"""
from __future__ import annotations

from .. import config, llm
from ..graph import Graph

SCHEMA = {
    "type": "object",
    "properties": {
        "verdicts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer"},
                    "supported": {"type": "boolean"},
                    "issue": {"type": "string"},
                },
                "required": ["index", "supported", "issue"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["verdicts"],
    "additionalProperties": False,
}

SYSTEM = """You are a strict fact checker. For each numbered claim, decide whether the quoted evidence it cites directly supports it.

- supported = true only if the quotes state the relationship in the claim (paraphrase is fine; inference beyond the quote is not).
- A claim that cites no evidence is supported only if it explicitly says the link is curated/unquoted.
- issue: empty when supported, otherwise a short reason (e.g. "quote names Samsung, not TSMC")."""


def check(g: Graph, explanation: dict, ip_hash: str | None = None) -> tuple[dict, float]:
    claims = []
    for c in explanation.get("companies", []):
        for cl in c.get("claims", []):
            claims.append((c["id"], cl))
    if not claims:
        return explanation, 0.0
    lines = []
    for i, (_, cl) in enumerate(claims):
        ev = [g.evidence[e] for e in cl["evidence_ids"] if e in g.evidence]
        quotes = " | ".join(f'[E{e["id"]}] "{e["quote"][:300]}"' for e in ev) or "(no evidence cited)"
        lines.append(f"{i}. Claim: {cl['text']}\n   Evidence: {quotes}")
    result, cost = llm.json_call(purpose="critic", model=config.MODEL_EXPLAIN, system=SYSTEM,
                                 user="\n".join(lines), schema=SCHEMA, max_tokens=4000, ip_hash=ip_hash)
    verdicts = {v["index"]: v for v in result["verdicts"]}
    for i, (_, cl) in enumerate(claims):
        v = verdicts.get(i, {"supported": False, "issue": "not checked"})
        unknown_ids = [e for e in cl["evidence_ids"] if e not in g.evidence]
        cl["supported"] = bool(v["supported"]) and not unknown_ids
        cl["issue"] = v["issue"] or ("cites unknown evidence" if unknown_ids else "")
    total = len(claims)
    ok = sum(1 for _, cl in claims if cl["supported"])
    explanation["critic"] = {"claims": total, "supported": ok}
    return explanation, cost
