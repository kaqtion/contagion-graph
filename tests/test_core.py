"""Tests for the deterministic core: quote checks, resolution, traversal and scoring."""
from datetime import date, timedelta

import pytest

from contagion import config
from contagion.agents.extractor import norm_text, verify_quote
from contagion.agents.resolver import Resolver, commodity_id, region_id
from contagion.db import Alias, Edge, EdgeEvidence, Evidence, Node, init_db, session
from contagion.graph import invalidate
from contagion.pipeline import trace
from scripts.load_graph import strength_for

TODAY = date.today()


@pytest.fixture(scope="module", autouse=True)
def graph():
    """FAB supplies CHIPCO (sole), CHIPCO supplies BOXCO (major), RIVAL competes with FAB, FAB is in Taiwan."""
    init_db()
    with session() as s:
        for nid, name in [("FAB", "Fab Corp"), ("CHIPCO", "Chip Co"), ("BOXCO", "Box Co"), ("RIVAL", "Rival Foundry"),
                          ("OLDCO", "Old Co")]:
            s.merge(Node(id=nid, kind="company", name=name, ticker=nid, in_universe=True, coverage="high"))
            s.merge(Alias(alias=name.lower(), node_id=nid))
        s.merge(Alias(alias="fabby", node_id="FAB"))
        s.merge(Node(id="region:taiwan", kind="region", name="Taiwan"))
        s.flush()
        ev = Evidence(quote="We rely on Fab Corp as our sole foundry.", verified=True, source_label="t", as_of=TODAY)
        s.add(ev)
        s.flush()
        edges = [
            Edge(src="FAB", dst="CHIPCO", rel="supplies_to", strength=0.9, tier="sole", status="verified", as_of=TODAY),
            Edge(src="CHIPCO", dst="BOXCO", rel="supplies_to", strength=0.6, tier="major", status="verified", as_of=TODAY),
            Edge(src="FAB", dst="RIVAL", rel="competes_with", strength=0.6, tier="major", status="verified", as_of=TODAY),
            Edge(src="FAB", dst="region:taiwan", rel="operates_in", strength=0.9, tier="sole", status="verified", as_of=TODAY),
            Edge(src="OLDCO", dst="region:taiwan", rel="operates_in", strength=0.6, tier="major", status="verified",
                 as_of=TODAY - timedelta(days=36 * 30)),
        ]
        s.add_all(edges)
        s.flush()
        for e in edges:
            s.add(EdgeEvidence(edge_id=e.id, evidence_id=ev.id))
        s.commit()
    invalidate()


def event(**kw):
    base = {"event_type": "supply_disruption", "polarity": "negative", "severity": 5, "expected_duration": "weeks",
            "origin_companies": ["Fab Corp"], "regions": [], "commodities": [], "summary": ""}
    return {**base, **kw}


def scores(result):
    return {r["id"]: r for r in result["exposures"]}


def test_quote_must_be_verbatim():
    src = norm_text("We rely on Taiwan Semiconductor Manufacturing Company Limited (“TSMC”) for wafers.")
    assert verify_quote('Taiwan Semiconductor Manufacturing Company Limited ("TSMC")', src)
    assert not verify_quote("We rely heavily on TSMC for all wafers", src)


def test_resolver_aliases_and_generic_names():
    r = Resolver()
    assert r.resolve("Fabby").node_id == "FAB"
    assert r.resolve("Fab Corporation").node_id == "FAB"  # legal suffix stripped
    assert r.resolve("Customer A").method == "generic"
    assert region_id("Mainland China") == "region:china"
    assert commodity_id("neon gas") == "commodity:neon"


def test_strength_mapping():
    assert strength_for("minor", 45) == (0.9, "disclosed")
    assert strength_for("minor", 12) == (0.6, "disclosed")
    assert strength_for("sole", None) == (0.9, "tier")


def test_downstream_signs_and_decay():
    s = scores(trace_graph(event()))
    assert s["FAB"]["is_origin"] and s["FAB"]["impact"] == pytest.approx(-1.0)
    # hop 1: severity 1.0 * -1 * 0.9
    assert s["CHIPCO"]["impact"] == pytest.approx(-0.9)
    # hop 2: 0.9 * 0.6 * lambda(0.5)
    assert s["BOXCO"]["impact"] == pytest.approx(-0.9 * 0.6 * config.HOP_DECAY)
    # competitors benefit
    assert s["RIVAL"]["impact"] == pytest.approx(0.6)


def test_demand_shock_goes_upstream():
    s = scores(trace_graph(event(event_type="demand_shock", origin_companies=["Box Co"])))
    assert s["CHIPCO"]["hop"] == 1 and s["CHIPCO"]["impact"] < 0
    assert s["FAB"]["hop"] == 2


def test_region_seed_does_not_double_count_origin():
    s = scores(trace_graph(event(event_type="regional_disaster", regions=["Taiwan"])))
    # CHIPCO is reached only through FAB (the company origin), never again via Taiwan -> FAB -> CHIPCO
    assert s["CHIPCO"]["path_count"] == 1
    assert s["CHIPCO"]["impact"] == pytest.approx(-0.9)


def test_stale_evidence_decays_and_is_flagged():
    s = scores(trace_graph(event(event_type="regional_disaster", origin_companies=[], regions=["Taiwan"])))
    old = s["OLDCO"]
    assert old["quality"] == "speculative"
    assert abs(old["impact"]) < 0.6 * 0.5  # 36 months old -> freshness 0.25


def test_macro_events_are_not_traced():
    r = trace_graph(event(event_type="macro_rates", origin_companies=[]))
    assert r["note"] and r["stats"]["reached"] == 0


def trace_graph(ev):
    from contagion.graph import get_graph
    return trace(get_graph(), ev)
