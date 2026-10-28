"""Step 3: run the Extractor agent over downloaded filings via the Message Batches API (50% cheaper).

    python -m scripts.extract estimate          # token/cost estimate, no API spend
    python -m scripts.extract sync NVDA         # one filing synchronously (quick test)
    python -m scripts.extract submit            # submit a batch for every filing not yet extracted
    python -m scripts.extract collect           # poll + download batch results

Results land in data/extracted/<TICKER>.json with every quote checked against the source text.
"""
from __future__ import annotations

import json
import sys
import time

from contagion import config, llm
from contagion.agents.extractor import build_user_message, norm_text, request_params, verify_quote
from contagion.db import Node, session

FILINGS = config.DATA / "filings"
OUT = config.DATA / "extracted"
BATCH_FILE = config.DATA / "extract_batch.json"


def _filings(only: list[str]) -> list[dict]:
    rows = []
    for path in sorted(FILINGS.glob("*.json")):
        if only and path.stem not in only:
            continue
        rows.append(json.loads(path.read_text(encoding="utf-8")))
    return rows


def _message(f: dict) -> str:
    with session() as s:
        name = s.get(Node, f["ticker"]).name
    return build_user_message(name, f["ticker"], f["form"], f["filed_at"], f["passages"])


def _save(f: dict, data: dict, cost: float) -> None:
    OUT.mkdir(exist_ok=True)
    source = norm_text(f["text"])
    rels = data.get("relations", [])
    for r in rels:
        r["verified"] = verify_quote(r["quote"], source)
    out = {"ticker": f["ticker"], "form": f["form"], "filed_at": f["filed_at"], "url": f["url"],
           "accession": f["accession"], "cost_usd": round(cost, 5), "relations": rels}
    (OUT / f"{f['ticker']}.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    ok = sum(r["verified"] for r in rels)
    print(f"{f['ticker']:6} {len(rels):3} relations, {ok} verified, ${cost:.4f}")


def estimate() -> None:
    files = _filings([])
    chars = sum(len(_message(f)) for f in files) + len(files) * 3000
    in_tok = chars / 3.8
    out_tok = len(files) * 2500
    print(f"{len(files)} filings, ~{in_tok/1e6:.2f}M input tokens, ~{out_tok/1e6:.2f}M output tokens")
    print(f"Estimated batch cost on {config.MODEL_EXTRACT}: ${llm.cost_of(config.MODEL_EXTRACT, in_tok, out_tok, batch=True):.2f}")


def sync(only: list[str]) -> None:
    for f in _filings(only):
        resp = llm.client().messages.create(**request_params(_message(f)))
        cost = llm.record("extract", config.MODEL_EXTRACT, resp.usage)
        text = next(b.text for b in resp.content if b.type == "text")
        _save(f, json.loads(text), cost)


def submit(only: list[str]) -> None:
    done = {p.stem for p in OUT.glob("*.json")} if OUT.exists() else set()
    todo = [f for f in _filings(only) if f["ticker"] not in done]
    if not todo:
        print("Nothing to extract.")
        return
    batch = llm.client().messages.batches.create(
        requests=[{"custom_id": f["ticker"], "params": request_params(_message(f))} for f in todo]
    )
    BATCH_FILE.write_text(json.dumps({"id": batch.id, "tickers": [f["ticker"] for f in todo]}))
    print(f"Submitted batch {batch.id} with {len(todo)} filings. Run `collect` to fetch results.")


def collect() -> None:
    info = json.loads(BATCH_FILE.read_text())
    c = llm.client()
    while True:
        b = c.messages.batches.retrieve(info["id"])
        print(f"status={b.processing_status} counts={b.request_counts}")
        if b.processing_status == "ended":
            break
        time.sleep(30)
    by_ticker = {f["ticker"]: f for f in _filings(info["tickers"])}
    for res in c.messages.batches.results(info["id"]):
        f = by_ticker[res.custom_id]
        if res.result.type != "succeeded":
            print(f"{res.custom_id:6} {res.result.type}")
            continue
        msg = res.result.message
        cost = llm.record("extract", config.MODEL_EXTRACT, msg.usage, batch=True)
        if msg.stop_reason not in ("end_turn", "stop_sequence"):
            print(f"{res.custom_id:6} stopped: {msg.stop_reason}")
            continue
        text = next(b.text for b in msg.content if b.type == "text")
        _save(f, json.loads(text), cost)


if __name__ == "__main__":
    cmd, args = sys.argv[1], sys.argv[2:]
    {"estimate": lambda: estimate(), "sync": lambda: sync(args), "submit": lambda: submit(args),
     "collect": lambda: collect()}[cmd]()
