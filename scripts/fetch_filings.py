"""Step 2: download the latest 10-K / 20-F / 40-F for every SEC filer in the universe.

    python -m scripts.fetch_filings [TICKER ...]
"""
from __future__ import annotations

import sys

from contagion.db import Node, select, session
from contagion.ingest.edgar import fetch_company


def main(only: list[str]) -> None:
    with session() as s:
        filers = s.scalars(select(Node).where(Node.kind == "company", Node.sec_filer.is_(True))).all()
    for node in filers:
        if only and node.id not in only:
            continue
        try:
            path = fetch_company(node.id, node.cik)
            print(f"{node.id:6} {'ok' if path else 'no annual report'}")
        except Exception as e:  # keep going; one bad filing shouldn't stop the batch
            print(f"{node.id:6} FAILED: {e}")


if __name__ == "__main__":
    main(sys.argv[1:])
