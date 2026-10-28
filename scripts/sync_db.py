"""Copy the local SQLite database into the hosted Postgres database (Neon).

    python -m scripts.sync_db "postgresql://user:pass@host/db?sslmode=require"
    python -m scripts.sync_db            # uses DATABASE_URL_UNPOOLED from .env.local (written by `neon env pull`)

Replaces the target's graph, evidence, runs and back-tests with the local copy. Usage logs and review
decisions already on the target are kept.
"""
from __future__ import annotations

import os
import sys

from sqlalchemy import create_engine, delete, insert, select

from contagion import config
from contagion.db import (
    Alias, Backtest, Base, Document, Edge, EdgeEvidence, Evidence, Node, Run, Unresolved,
)

# parents before children
TABLES = [Node, Alias, Document, Evidence, Edge, EdgeEvidence, Run, Backtest, Unresolved]


def main(target_url: str) -> None:
    target_url = config.pg_url(target_url)
    src = create_engine(f"sqlite:///{config.DATA / 'contagion.db'}")
    dst = create_engine(target_url)
    Base.metadata.create_all(dst)
    with src.connect() as s, dst.begin() as d:
        for model in reversed(TABLES):
            d.execute(delete(model.__table__))
        for model in TABLES:
            rows = [dict(r._mapping) for r in s.execute(select(model.__table__))]
            for i in range(0, len(rows), 500):
                d.execute(insert(model.__table__), rows[i:i + 500])
            print(f"{model.__tablename__:15} {len(rows)}")
        # keep Postgres id sequences ahead of the copied ids
        for model in (Document, Evidence, Edge):
            t = model.__tablename__
            d.exec_driver_sql(f"SELECT setval(pg_get_serial_sequence('{t}', 'id'), COALESCE((SELECT MAX(id) FROM {t}), 1))")
    print("done")


if __name__ == "__main__":
    # bulk copy + DDL go over the direct endpoint, not the transaction-mode pooler
    url = sys.argv[1] if len(sys.argv) > 1 else os.getenv("DATABASE_URL_UNPOOLED") or os.getenv("DATABASE_URL", "")
    if not url:
        sys.exit("Pass a Postgres URL or run `neon env pull` to write DATABASE_URL_UNPOOLED into .env.local")
    main(url)
