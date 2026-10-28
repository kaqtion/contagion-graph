"""Thin wrapper over the Anthropic SDK: JSON-schema outputs, usage logging and spend guards."""
from __future__ import annotations

import hashlib
import json
from datetime import timedelta

import anthropic
from sqlalchemy import func

from . import config
from .db import LlmCall, select, session, utcnow


class BudgetExceeded(Exception):
    pass


class LlmUnavailable(Exception):
    pass


_client: anthropic.Anthropic | None = None


def client() -> anthropic.Anthropic:
    global _client
    if not config.llm_enabled():
        raise LlmUnavailable("ANTHROPIC_API_KEY is not set")
    if _client is None:
        _client = anthropic.Anthropic(timeout=60.0, max_retries=2)
    return _client


def cost_of(model: str, input_tokens: int, output_tokens: int, batch: bool = False) -> float:
    pin, pout = config.PRICES.get(model, (4.0, 20.0))
    cost = (input_tokens * pin + output_tokens * pout) / 1_000_000
    return cost / 2 if batch else cost


def hash_ip(ip: str | None) -> str | None:
    return hashlib.sha256(ip.encode()).hexdigest()[:32] if ip else None


def spent_today() -> float:
    start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    with session() as s:
        total = s.scalar(
            select(func.coalesce(func.sum(LlmCall.cost_usd), 0.0)).where(
                LlmCall.ts >= start, LlmCall.purpose.in_(("event", "explain", "critic"))
            )
        )
    return float(total or 0.0)


def runs_last_hour(ip_hash: str) -> int:
    with session() as s:
        return int(s.scalar(
            select(func.count()).select_from(LlmCall).where(
                LlmCall.ip_hash == ip_hash, LlmCall.purpose == "event",
                LlmCall.ts >= utcnow() - timedelta(hours=1),
            )
        ) or 0)


def check_budget(ip_hash: str | None) -> None:
    if spent_today() >= config.DAILY_BUDGET_USD:
        raise BudgetExceeded("The demo's daily AI budget is used up. Saved and demo events still work.")
    if ip_hash and runs_last_hour(ip_hash) >= config.RUNS_PER_IP_PER_HOUR:
        raise BudgetExceeded("Too many new headlines from this device in the last hour. Try again later.")


def record(purpose: str, model: str, usage, ip_hash: str | None = None, batch: bool = False) -> float:
    in_tok = (usage.input_tokens or 0) + (getattr(usage, "cache_creation_input_tokens", 0) or 0) \
        + (getattr(usage, "cache_read_input_tokens", 0) or 0)
    out_tok = usage.output_tokens or 0
    cost = cost_of(model, in_tok, out_tok, batch)
    with session() as s:
        s.add(LlmCall(ip_hash=ip_hash, purpose=purpose, model=model,
                      input_tokens=in_tok, output_tokens=out_tok, cost_usd=cost))
        s.commit()
    return cost


def json_call(*, purpose: str, model: str, system: str, user: str, schema: dict,
              max_tokens: int = 4000, ip_hash: str | None = None) -> tuple[dict, float]:
    """One structured-output call. Returns (parsed JSON, cost in USD)."""
    resp = client().messages.create(
        model=model,
        max_tokens=max_tokens,
        system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
        messages=[{"role": "user", "content": user}],
        output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
    )
    cost = record(purpose, model, resp.usage, ip_hash)
    if resp.stop_reason == "refusal":
        raise LlmUnavailable("The model declined this request.")
    if resp.stop_reason == "max_tokens":
        raise LlmUnavailable("The model response was cut off; try a shorter headline.")
    text = next(b.text for b in resp.content if b.type == "text")
    return json.loads(text), cost
