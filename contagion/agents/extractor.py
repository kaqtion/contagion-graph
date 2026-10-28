"""Extractor agent: filing passages -> (subject, relation, object, strength, verbatim quote) triples."""
from __future__ import annotations

import re
import unicodedata

from .. import config

RELATIONS = ["supplies_to", "buys_from", "competes_with", "operates_in", "depends_on", "produces"]

SCHEMA = {
    "type": "object",
    "properties": {
        "relations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "subject": {"type": "string"},
                    "relation": {"type": "string", "enum": RELATIONS},
                    "object": {"type": "string"},
                    "strength_tier": {"type": "string", "enum": ["sole", "major", "minor"]},
                    "revenue_pct": {"anyOf": [{"type": "number"}, {"type": "null"}]},
                    "quote": {"type": "string"},
                },
                "required": ["subject", "relation", "object", "strength_tier", "revenue_pct", "quote"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["relations"],
    "additionalProperties": False,
}

SYSTEM = """You extract business relationships from SEC annual reports for a supply-chain risk graph.

Return only relationships that the text states explicitly about a NAMED counterparty. "We", "our" and "the Company" mean the filer named by the user.

Relations (subject -> object):
- supplies_to: subject sells products, components or services to object (object is a customer).
- buys_from: subject sources from object (object is a supplier, foundry, contract manufacturer, assembler).
- competes_with: object is named as a competitor of subject.
- operates_in: subject has manufacturing, fabs, key suppliers or a large share of revenue in object, which must be a country or region.
- depends_on: subject relies on object, which must be a raw material or commodity (e.g. lithium, neon, rare earths, silicon wafers).
- produces: subject produces or sells the commodity object.

strength_tier:
- sole: sole or single source, "substantially all", or the only named provider.
- major: described as significant, key, primary or principal, or a disclosed share of 10% or more.
- minor: merely listed among several.
revenue_pct: the disclosed percentage of revenue or purchases for this counterparty, else null.

Rules:
- quote must be copied EXACTLY, character for character, from the text: one contiguous span of at most 300 characters that contains both the evidence and the counterparty's name. Never paraphrase or join separate sentences.
- Skip anonymous counterparties ("Customer A", "a distributor", "one direct customer").
- Use the counterparty's name as written (e.g. "Taiwan Semiconductor Manufacturing Company Limited", "TSMC").
- At most 40 relationships; prefer supplier/customer links, then competitors, then regions and commodities.
- If nothing qualifies, return an empty list."""


def build_user_message(filer_name: str, ticker: str, form: str, filed_at: str, passages: list[str]) -> str:
    body = "\n\n".join(f"[{i + 1}] {p}" for i, p in enumerate(passages))
    return f"Filer: {filer_name} ({ticker}), {form} filed {filed_at}.\n\nPassages:\n\n{body}"


def request_params(user_message: str) -> dict:
    return {
        "model": config.MODEL_EXTRACT,
        "max_tokens": 8000,
        "system": [{"type": "text", "text": SYSTEM, "cache_control": {"type": "ephemeral"}}],
        "messages": [{"role": "user", "content": user_message}],
        "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
    }


_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-",
                         "—": "-", " ": " ", "�": ""})


def norm_text(s: str) -> str:
    s = unicodedata.normalize("NFKC", s).translate(_QUOTES).lower()
    return re.sub(r"\s+", " ", s).strip()


def verify_quote(quote: str, normalized_source: str) -> bool:
    q = norm_text(quote).strip(" .\"'")
    return len(q) >= 20 and q in normalized_source
