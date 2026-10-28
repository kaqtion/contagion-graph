"""Step 1: create nodes + aliases for the company universe, regions and commodities.

    python -m scripts.build_universe
"""
from __future__ import annotations

import csv

from contagion import config
from contagion.agents.resolver import COMMODITIES, REGIONS, norm, norm_core
from contagion.db import Alias, Node, init_db, session
from contagion.ingest.edgar import ticker_map


def main() -> None:
    init_db()
    sec = ticker_map()
    rows = list(csv.DictReader(open(config.DATA / "universe.csv", encoding="utf-8")))
    with session() as s:
        for r in rows:
            info = None if r["name"] else sec.get(r["id"])  # named rows are non-SEC companies
            aliases = [a for a in r["aliases"].split("|") if a]
            # display name: explicit name, else the first common alias, else SEC's legal name
            name = r["name"] or (aliases[0] if aliases else None) or (info["name"] if info else r["id"])
            legal = info["name"] if info else name
            node = s.get(Node, r["id"]) or Node(id=r["id"], kind="company")
            node.name = name
            node.ticker = r["id"] if info else None
            node.cik = info["cik"] if info else None
            node.sec_filer = bool(info)
            node.country, node.sector, node.in_universe = r["country"], r["sector"], True
            s.merge(node)
            keys = {norm(name), norm_core(name), norm(legal), norm_core(legal)} | {norm(a) for a in aliases}
            for k in keys:
                if k:
                    s.merge(Alias(alias=k, node_id=r["id"], source="seed"))
        for label in set(REGIONS.values()):
            s.merge(Node(id=f"region:{norm(label).replace(' ', '-')}", kind="region", name=label, in_universe=True))
        for label in set(COMMODITIES.values()):
            s.merge(Node(id=f"commodity:{norm(label).replace(' ', '-')}", kind="commodity", name=label,
                         in_universe=True))
        s.commit()
    missing = [r["id"] for r in rows if not r["name"] and r["id"] not in sec]
    print(f"{len(rows)} companies loaded; not found on SEC: {missing or 'none'}")


if __name__ == "__main__":
    main()
