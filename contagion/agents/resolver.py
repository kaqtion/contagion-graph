"""Entity resolver: maps raw names ("Taiwan Semi", "TSMC", "2330.TW") to one canonical node.

Order: exact alias -> ticker -> fuzzy alias match (rapidfuzz) -> optional LLM tie-break for close calls.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from rapidfuzz import fuzz, process

from ..db import Alias, Node, select, session

_SUFFIXES = re.compile(
    r"\b(incorporated|inc|corporation|corp|company|co|limited|ltd|plc|llc|lp|ag|se|nv|n v|sa|s a|gmbh|kk|k k|"
    r"ab|spa|s p a|sas|bv|b v|oyj|asa|pte|pvt|bhd|tbk|"
    r"holdings?|group|technologies|technology|the)\b"
)
GENERIC = {
    "customer a", "customer b", "customer c", "customer d", "our customers", "customers", "suppliers",
    "our suppliers", "distributors", "a distributor", "contract manufacturers", "third party", "third parties",
    "foundries", "competitors", "us government", "u s government", "government", "oems", "odms",
    "various suppliers", "certain customers", "end customers", "hyperscalers", "subcontractors",
}

REGIONS = {
    "taiwan": "Taiwan", "china": "China", "mainland china": "China", "prc": "China", "hong kong": "China",
    "japan": "Japan", "south korea": "South Korea", "korea": "South Korea", "united states": "United States",
    "us": "United States", "usa": "United States", "u s": "United States", "germany": "Germany",
    "mexico": "Mexico", "malaysia": "Malaysia", "vietnam": "Vietnam", "thailand": "Thailand",
    "philippines": "Philippines", "israel": "Israel", "netherlands": "Netherlands", "india": "India",
    "europe": "Europe", "european union": "Europe", "eu": "Europe", "russia": "Russia", "ukraine": "Ukraine",
    "singapore": "Singapore", "middle east": "Middle East", "red sea": "Red Sea", "canada": "Canada",
    "ireland": "Ireland", "france": "France", "italy": "Italy", "united kingdom": "United Kingdom",
    "uk": "United Kingdom", "texas": "United States", "arizona": "United States", "asia": "Asia",
    "southeast asia": "Southeast Asia", "costa rica": "Costa Rica", "brazil": "Brazil", "chile": "Chile",
    "australia": "Australia", "indonesia": "Indonesia", "strait of hormuz": "Middle East", "hormuz": "Middle East",
}

COMMODITIES = {
    "neon": "Neon", "neon gas": "Neon", "helium": "Helium", "palladium": "Palladium", "platinum": "Platinum",
    "lithium": "Lithium", "cobalt": "Cobalt", "nickel": "Nickel", "copper": "Copper", "aluminum": "Aluminum",
    "aluminium": "Aluminum", "steel": "Steel", "rare earth": "Rare earths", "rare earths": "Rare earths",
    "rare earth elements": "Rare earths", "gallium": "Gallium", "germanium": "Germanium", "silicon": "Silicon",
    "polysilicon": "Silicon", "silicon wafers": "Silicon wafers", "wafers": "Silicon wafers",
    "oil": "Oil", "crude oil": "Oil", "natural gas": "Natural gas", "energy": "Energy", "electricity": "Energy",
    "water": "Water", "gold": "Gold", "tantalum": "Tantalum", "tungsten": "Tungsten", "graphite": "Graphite",
    "magnesium": "Magnesium", "resin": "Resin", "rubber": "Rubber", "hbm": "HBM memory", "dram": "DRAM",
    "nand": "NAND flash", "memory": "DRAM",
}


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9.]+", " ", s)
    s = s.replace(".", " ").strip()
    s = re.sub(r"\s+", " ", s)
    return s


def norm_core(name: str) -> str:
    """Normalised name without legal suffixes, for fuzzy matching."""
    s = _SUFFIXES.sub(" ", norm(name))
    return re.sub(r"\s+", " ", s).strip()


def region_id(name: str) -> str | None:
    label = REGIONS.get(norm(name))
    return f"region:{norm(label).replace(' ', '-')}" if label else None


def region_label(name: str) -> str | None:
    return REGIONS.get(norm(name))


def commodity_id(name: str) -> str | None:
    label = COMMODITIES.get(norm(name)) or COMMODITIES.get(norm(name).rstrip("s"))
    return f"commodity:{norm(label).replace(' ', '-')}" if label else None


def commodity_label(name: str) -> str | None:
    return COMMODITIES.get(norm(name)) or COMMODITIES.get(norm(name).rstrip("s"))


@dataclass
class Match:
    node_id: str | None
    score: float
    method: str  # exact | ticker | fuzzy | ambiguous | none | generic
    candidates: list[tuple[str, float]]


class Resolver:
    def __init__(self) -> None:
        with session() as s:
            # only the curated universe: external nodes from a previous load must never become match targets
            nodes = s.scalars(select(Node).where(Node.kind == "company", Node.in_universe.is_(True))).all()
            aliases = s.scalars(select(Alias).where(Alias.source != "external")).all()
        self.names = {n.id: n.name for n in nodes}
        self.tickers = {n.ticker.upper(): n.id for n in nodes if n.ticker}
        self.exact: dict[str, set[str]] = {}
        for a in aliases:
            self.exact.setdefault(a.alias, set()).add(a.node_id)
        for n in nodes:
            for key in {norm(n.name), norm_core(n.name)}:
                if key:
                    self.exact.setdefault(key, set()).add(n.id)
        # Fuzzy index on suffix-stripped names
        self.core: dict[str, str] = {}
        for key, ids in self.exact.items():
            if len(ids) == 1:
                self.core[norm_core(key) or key] = next(iter(ids))

    def resolve(self, raw: str) -> Match:
        raw = raw.strip()
        if not raw:
            return Match(None, 0, "none", [])
        n = norm(raw)
        if n in GENERIC or n.startswith(("customer ", "supplier ", "certain ", "other ")):
            return Match(None, 0, "generic", [])
        if raw.upper() in self.tickers and (raw.isupper() or "." in raw):
            return Match(self.tickers[raw.upper()], 100, "ticker", [])
        for key in (n, norm_core(raw)):
            ids = self.exact.get(key)
            if ids and len(ids) == 1:
                return Match(next(iter(ids)), 100, "exact", [])
        core = norm_core(raw)
        if len(core) < 3:
            return Match(None, 0, "none", [])
        hits = process.extract(core, list(self.core), scorer=fuzz.token_sort_ratio, limit=3)
        cands = [(self.core[k], float(sc)) for k, sc, _ in hits]
        if cands and cands[0][1] >= 92 and (len(cands) == 1 or cands[0][1] - cands[1][1] >= 5):
            return Match(cands[0][0], cands[0][1], "fuzzy", cands)
        if cands and cands[0][1] >= 80:
            return Match(None, cands[0][1], "ambiguous", cands)
        return Match(None, cands[0][1] if cands else 0, "none", cands)
