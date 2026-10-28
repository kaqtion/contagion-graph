"""SEC EDGAR ingestion: latest annual report per company -> clean text -> relationship-dense passages."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

import warnings

import httpx
from bs4 import BeautifulSoup, XMLParsedAsHTMLWarning

from .. import config

warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)

FILINGS_DIR = config.DATA / "filings"
ANNUAL_FORMS = ("10-K", "20-F", "40-F")
_last_request = 0.0


def _get(url: str) -> httpx.Response:
    """SEC allows 10 requests/second and requires a descriptive User-Agent."""
    global _last_request
    if not config.SEC_USER_AGENT:
        raise RuntimeError("Set SEC_USER_AGENT (e.g. 'Your Name your-email@domain.com') in .env.local")
    wait = 0.15 - (time.time() - _last_request)
    if wait > 0:
        time.sleep(wait)
    _last_request = time.time()
    resp = httpx.get(url, headers={"User-Agent": config.SEC_USER_AGENT}, timeout=60, follow_redirects=True)
    resp.raise_for_status()
    return resp


def ticker_map() -> dict[str, dict]:
    cache = config.DATA / "sec_company_tickers.json"
    if not cache.exists():
        cache.write_bytes(_get("https://www.sec.gov/files/company_tickers.json").content)
    rows = json.loads(cache.read_text())
    return {r["ticker"].upper(): {"cik": str(r["cik_str"]).zfill(10), "name": r["title"]} for r in rows.values()}


def latest_annual(cik: str) -> dict | None:
    sub = _get(f"https://data.sec.gov/submissions/CIK{cik}.json").json()
    recent = sub["filings"]["recent"]
    for i, form in enumerate(recent["form"]):
        if form in ANNUAL_FORMS:
            acc = recent["accessionNumber"][i]
            doc = recent["primaryDocument"][i]
            return {
                "form": form,
                "filed_at": recent["filingDate"][i],
                "accession": acc,
                "url": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/{doc}",
            }
    return None


def html_to_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup(["script", "style", "ix:header"]):
        tag.decompose()
    # Inline XBRL hides a lot of metadata in display:none blocks
    for tag in soup.select('[style*="display:none"]'):
        tag.decompose()
    blocks, seen = [], set()
    for el in soup.find_all(["p", "div", "li", "td"]):
        if el.find(["p", "div", "li", "table"]):
            continue  # only leaf-ish blocks, to avoid duplicating nested text
        text = re.sub(r"\s+", " ", el.get_text(" ", strip=True)).replace("�", "")
        if text and (len(text) < 40 or text not in seen):
            seen.add(text)
            blocks.append(text)
    # merge consecutive short fragments (tables split into cells, etc.)
    out: list[str] = []
    for b in blocks:
        if out and len(out[-1]) < 120 and not out[-1].endswith((".", ":", ";")):
            out[-1] = f"{out[-1]} {b}"
        else:
            out.append(b)
    return "\n".join(out)


_SIGNAL = re.compile(
    r"suppl(?:y|ier|iers|ied)|vendor|foundr|wafer|fab\b|contract manufactur|assembly and test|"
    r"sole[- ]source|single[- ]source|limited number of|customer|% of (?:our )?(?:total |net )?(?:revenue|sales)|"
    r"accounted for|compet|rely on|relies on|depend|raw material|commodit|lithium|cobalt|nickel|neon|helium|"
    r"palladium|rare earth|gallium|germanium|manufactured (?:by|in)|located in|facilities in|operations in",
    re.I,
)
_NAMED = re.compile(r"\b(?:[A-Z][a-zA-Z&\-]+ ){0,3}(?:Inc|Corp|Corporation|Ltd|Limited|Co\.|Company|AG|N\.V\.|plc)\b|\b[A-Z]{3,}\b")
_CONCENTRATION = re.compile(r"\d{1,2}(?:\.\d)?\s?%", re.I)


def select_passages(text: str, max_chars: int = 40_000) -> list[str]:
    """Rank paragraphs by how likely they are to name a relationship; keep the best within a size budget."""
    scored = []
    for i, para in enumerate(text.split("\n")):
        if len(para) < 80 or len(para) > 4000:
            continue
        signals = len(_SIGNAL.findall(para))
        if not signals:
            continue
        named = len(_NAMED.findall(para))
        conc = 2 if _CONCENTRATION.search(para) and re.search(r"customer|revenue|sales", para, re.I) else 0
        score = signals + 2 * min(named, 4) + conc
        if score >= 4:
            scored.append((score, i, para))
    scored.sort(key=lambda t: -t[0])
    chosen, size = [], 0
    for score, i, para in scored:
        if size + len(para) > max_chars:
            continue
        chosen.append((i, para))
        size += len(para)
    return [p for _, p in sorted(chosen)]


def fetch_company(ticker: str, cik: str, force: bool = False) -> Path | None:
    """Download the latest annual report and store text + selected passages as JSON."""
    FILINGS_DIR.mkdir(parents=True, exist_ok=True)
    out = FILINGS_DIR / f"{ticker}.json"
    if out.exists() and not force:
        return out
    meta = latest_annual(cik)
    if not meta:
        return None
    text = html_to_text(_get(meta["url"]).text)
    passages = select_passages(text)
    out.write_text(json.dumps({"ticker": ticker, "cik": cik, **meta, "text": text, "passages": passages}),
                   encoding="utf-8")
    return out
