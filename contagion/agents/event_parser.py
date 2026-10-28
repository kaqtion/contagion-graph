"""Event parser agent: headline -> typed event (fixed taxonomy), origins, severity."""
from __future__ import annotations

from .. import config, llm

EVENT_TYPES = {
    "supply_disruption": "A producer's output is halted or cut (fire, outage, strike, quality recall, fab down).",
    "regional_disaster": "Earthquake, flood, war, blockade or power crisis hitting a country or region.",
    "demand_shock": "A buyer cuts orders, loses sales or cancels programs, so its suppliers lose revenue.",
    "financial_distress": "Bankruptcy, default, liquidity crisis or fraud at a company.",
    "commodity_shock": "Sharp price or availability change in a raw material (neon, lithium, oil, rare earths).",
    "sanctions_trade": "Sanctions, export controls, tariffs or trade bans on a country, region or company.",
    "regulatory": "New regulation, antitrust action or ruling that targets a company or industry.",
    "cyber_outage": "Cyberattack or IT outage disrupting a company's operations.",
    "capacity_expansion": "A company adds capacity, wins a contract or launches a product (usually positive).",
    "macro_rates": "Interest rates, inflation, FX or broad macro data with no specific company or region.",
}

SCHEMA = {
    "type": "object",
    "properties": {
        "event_type": {"type": "string", "enum": list(EVENT_TYPES)},
        "polarity": {"type": "string", "enum": ["negative", "positive"]},
        "severity": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
        "expected_duration": {"type": "string", "enum": ["days", "weeks", "months", "quarters", "permanent"]},
        "origin_companies": {"type": "array", "items": {"type": "string"}},
        "regions": {"type": "array", "items": {"type": "string"}},
        "commodities": {"type": "array", "items": {"type": "string"}},
        "summary": {"type": "string"},
    },
    "required": ["event_type", "polarity", "severity", "expected_duration", "origin_companies", "regions",
                 "commodities", "summary"],
    "additionalProperties": False,
}

SYSTEM = f"""You classify financial news headlines for a supply-chain contagion model.

Event types:
{chr(10).join(f"- {k}: {v}" for k, v in EVENT_TYPES.items())}

Fields:
- polarity: is the event bad (negative) or good (positive) for the origin?
- severity 1-5: 1 minor/rumour, 3 material for the origin's quarter, 5 multi-month halt of a critical producer or a broad regional shutdown.
- origin_companies: companies directly hit, by their common name (e.g. "TSMC", "Renesas Electronics"). Empty if none named.
- regions: countries or regions directly affected. Empty if none.
- commodities: raw materials directly affected. Empty if none.
- summary: one plain sentence restating what happened.

Examples:
"Earthquake halts TSMC fab in Taiwan" -> regional_disaster, negative, 4, weeks, ["TSMC"], ["Taiwan"], []
"Fire at Renesas Naka plant stops automotive chip line" -> supply_disruption, negative, 4, months, ["Renesas Electronics"], ["Japan"], []
"Apple cuts iPhone production orders by 10%" -> demand_shock, negative, 3, quarters, ["Apple"], [], []
"US expands export controls on advanced chip tools to China" -> sanctions_trade, negative, 4, permanent, [], ["China"], []
"Neon prices jump 10x as Ukraine suppliers shut" -> commodity_shock, negative, 3, months, [], ["Ukraine"], ["neon"]
"Fed raises rates 50bp" -> macro_rates, negative, 2, months, [], [], []"""


def parse_event(headline: str, ip_hash: str | None = None) -> tuple[dict, float]:
    event, cost = llm.json_call(purpose="event", model=config.MODEL_EVENT, system=SYSTEM,
                                user=f"Headline: {headline}", schema=SCHEMA, max_tokens=2000, ip_hash=ip_hash)
    return event, cost
