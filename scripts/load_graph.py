"""Step 4: resolve extracted names and (re)build edges + evidence. Deterministic and free: no LLM calls.

    python -m scripts.load_graph

Rebuilds documents/evidence/edges from data/extracted/*.json and data/curated_edges.csv, then re-applies
human review decisions and recomputes per-company coverage.
"""
from __future__ import annotations

import csv
import json
import re
from collections import Counter
from datetime import date

from sqlalchemy import delete

from contagion import config
from contagion.agents.resolver import Resolver, commodity_id, norm, region_id
from contagion.db import (
    Alias, Document, Edge, EdgeEvidence, Evidence, Node, ReviewDecision, Unresolved, init_db, select, session,
)


def strength_for(tier: str, pct: float | None) -> tuple[float, str]:
    if pct is not None and pct > 0:
        if pct >= 40:
            return 0.9, "disclosed"
        if pct >= 10:
            return 0.6, "disclosed"
        return 0.3, "disclosed"
    return config.TIER_WEIGHTS.get(tier, 0.3), "tier"


def _ext_id(name: str) -> str:
    return "ext:" + re.sub(r"[^a-z0-9]+", "-", norm(name)).strip("-")[:60]


def main() -> None:
    init_db()
    resolver = Resolver()
    unresolved: Counter[str] = Counter()
    examples: dict[str, str] = {}
    stats = Counter()
    with session() as s:
        for table in (EdgeEvidence, Edge, Evidence, Document, Unresolved):
            s.execute(delete(table))
        s.execute(delete(Node).where(Node.id.like("ext:%")))
        s.execute(delete(Alias).where(Alias.source == "external"))
        s.commit()

        edges: dict[tuple[str, str, str], Edge] = {}
        ext_nodes: dict[str, str] = {}

        def upsert_edge(src, dst, rel, strength, tier, pct, source, status, as_of, note=None) -> Edge:
            if rel == "competes_with":
                src, dst = sorted((src, dst))
            key = (src, dst, rel)
            e = edges.get(key)
            if e is None:
                e = Edge(src=src, dst=dst, rel=rel, strength=strength, tier=tier, pct=pct, strength_source=source,
                         status=status, as_of=as_of, note=note)
                s.add(e)
                s.flush()
                edges[key] = e
            else:
                if strength > e.strength:
                    e.strength, e.tier, e.pct, e.strength_source = strength, tier, pct, source
                if status == "verified":
                    e.status = "verified"
                if as_of and (not e.as_of or as_of > e.as_of):
                    e.as_of = as_of
            return e

        for path in sorted((config.DATA / "extracted").glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            filer = data["ticker"]
            filed = date.fromisoformat(data["filed_at"])
            doc = Document(node_id=filer, form=data["form"], filed_at=filed, url=data["url"],
                           accession=data["accession"])
            s.add(doc)
            s.flush()
            for r in data["relations"]:
                stats["extracted"] += 1
                if not r["verified"]:
                    stats["rejected_quote"] += 1
                    continue
                subj = resolver.resolve(r["subject"]).node_id
                if subj is None and norm(r["subject"]) in {"we", "the company", "our company"}:
                    subj = filer
                subj = subj or filer
                rel, obj_raw = r["relation"], r["object"]
                if rel == "operates_in":
                    obj = region_id(obj_raw)
                elif rel in ("depends_on", "produces"):
                    obj = commodity_id(obj_raw)
                else:
                    m = resolver.resolve(obj_raw)
                    obj = m.node_id
                    if obj is None and m.method in ("none", "ambiguous") and len(norm(obj_raw)) >= 3:
                        unresolved[obj_raw] += 1
                        examples.setdefault(obj_raw, r["quote"])
                        # keep the edge against an external (non-universe) node so the path isn't lost
                        obj = ext_nodes.get(norm(obj_raw))
                        if obj is None:
                            obj = _ext_id(obj_raw)
                            ext_nodes[norm(obj_raw)] = obj
                            if s.get(Node, obj) is None:
                                s.add(Node(id=obj, kind="company", name=obj_raw.strip(), in_universe=False))
                                s.flush()
                if obj is None or obj == subj:
                    stats["unresolved_or_self"] += 1
                    continue
                strength, source = strength_for(r["strength_tier"], r["revenue_pct"])
                if rel == "buys_from":
                    src, dst, rel = obj, subj, "supplies_to"
                else:
                    src, dst = subj, obj
                e = upsert_edge(src, dst, rel, strength, r["strength_tier"], r["revenue_pct"], source,
                                "verified", filed)
                ev = Evidence(document_id=doc.id, quote=r["quote"].strip(), verified=True, url=data["url"],
                              source_label=f"{filer} {data['form']}, {data['filed_at']}", as_of=filed)
                s.add(ev)
                s.flush()
                s.merge(EdgeEvidence(edge_id=e.id, evidence_id=ev.id))
                stats["edges_from_filings"] += 1

        curated = config.DATA / "curated_edges.csv"
        if curated.exists():
            for row in csv.DictReader(open(curated, encoding="utf-8")):
                rel = row["rel"]
                dst = row["dst"]
                if rel == "operates_in":
                    dst = region_id(dst) or dst
                elif rel in ("depends_on", "produces"):
                    dst = commodity_id(dst) or dst
                if s.get(Node, row["src"]) is None or s.get(Node, dst) is None:
                    print(f"curated edge skipped (unknown node): {row}")
                    continue
                if (row["src"], dst, rel) in edges or (rel == "competes_with" and tuple(sorted((row["src"], dst))) + (rel,) in edges):
                    continue  # filing evidence wins over curation
                strength = config.TIER_WEIGHTS[row["tier"]]
                upsert_edge(row["src"], dst, rel, strength, row["tier"], None, "curated", "curated",
                            date.fromisoformat(row["as_of"]), note=row["note"])
                stats["curated"] += 1

        for d in s.scalars(select(ReviewDecision)).all():
            src, rel, dst = d.key.split("|")
            e = edges.get((src, dst, rel))
            if e:
                e.status = d.status

        for raw, n in unresolved.items():
            s.merge(Unresolved(raw=raw[:200], count=n, example=examples.get(raw)))

        # coverage: how much of a company's neighbourhood is backed by its own or others' filings
        verified_deg: Counter[str] = Counter()
        any_deg: Counter[str] = Counter()
        for (src, dst, rel), e in edges.items():
            if e.status == "rejected":
                continue
            for n in (src, dst):
                any_deg[n] += 1
                if e.status == "verified":
                    verified_deg[n] += 1
        filed = {d.node_id for d in s.scalars(select(Document)).all()}
        for node in s.scalars(select(Node).where(Node.kind == "company")).all():
            v = verified_deg[node.id]
            if node.id in filed and v >= 6:
                node.coverage = "high"
            elif v >= 2 or (node.id in filed and v >= 1):
                node.coverage = "medium"
            elif any_deg[node.id]:
                node.coverage = "low"
            else:
                node.coverage = "none"
        s.commit()
    print(dict(stats))
    print(f"edges: {len(edges)}, external nodes: {len(ext_nodes)}, unresolved names: {len(unresolved)}")


if __name__ == "__main__":
    main()
