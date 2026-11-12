"""Tests for the MCP server: every tool, the resource and the prompt, through an in-memory MCP client.

LLM calls are replaced by a fake `llm.json_call`, so the real event parser, explainer and critic code runs without
the network. Fixture graph: Alpha Foundry supplies Beta Chips (sole), Beta Chips supplies Gamma Devices (major),
Delta Foundry competes with Alpha Foundry (curated, no quote).
"""
import re
from datetime import date

import pytest
from mcp import Client, MCPError
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from contagion import llm, pipeline
from contagion.db import Alias, Edge, EdgeEvidence, Evidence, Node, Run, init_db, session
from contagion.graph import invalidate
from contagion.mcp_server import mcp, ro_session

pytestmark = pytest.mark.anyio

TODAY = date.today()
DEMO_HEADLINE = "Fire halts Alpha Foundry fab for weeks"
NEW_HEADLINE = "Flood shuts Alpha Foundry plant"
EVENT = {"event_type": "supply_disruption", "polarity": "negative", "severity": 4, "expected_duration": "weeks",
         "origin_companies": ["Alpha Foundry"], "regions": [], "commodities": [], "summary": "Alpha Foundry is down."}


@pytest.fixture(scope="module", autouse=True)
def graph():
    init_db()
    with session() as s:
        for nid, name in [("ALFA", "Alpha Foundry"), ("BETA", "Beta Chips"), ("GAMA", "Gamma Devices"),
                          ("DLTA", "Delta Foundry")]:
            s.merge(Node(id=nid, kind="company", name=name, ticker=nid, sector="semis", country="Taiwan",
                         in_universe=True, coverage="high"))
            s.merge(Alias(alias=name.lower(), node_id=nid))
        s.flush()
        q1 = Evidence(quote="Alpha Foundry is our sole source of wafers.", verified=True,
                      source_label="BETA 10-K, 2026-02-01", url="https://example.test/beta", as_of=TODAY)
        q2 = Evidence(quote="Beta Chips supplies the processors in all of our devices.", verified=True,
                      source_label="GAMA 10-K, 2026-03-01", url="https://example.test/gama", as_of=TODAY)
        s.add_all([q1, q2])
        s.flush()
        e1 = Edge(src="ALFA", dst="BETA", rel="supplies_to", strength=0.9, tier="sole", status="verified", as_of=TODAY)
        e2 = Edge(src="BETA", dst="GAMA", rel="supplies_to", strength=0.6, tier="major", status="verified", as_of=TODAY)
        e3 = Edge(src="ALFA", dst="DLTA", rel="competes_with", strength=0.6, tier="major", status="curated",
                  as_of=TODAY, note="Both are pure-play foundries.")
        s.add_all([e1, e2, e3])
        s.flush()
        s.add_all([EdgeEvidence(edge_id=e1.id, evidence_id=q1.id), EdgeEvidence(edge_id=e2.id, evidence_id=q2.id)])
        s.commit()
    invalidate()
    demo = pipeline.analyze(DEMO_HEADLINE, event=EVENT, is_demo=True)
    return demo.id


@pytest.fixture
def anyio_backend():
    return "asyncio"


@pytest.fixture
async def client():
    async with Client(mcp, raise_exceptions=True) as c:
        yield c


class FakeLLM:
    """Stands in for llm.json_call: answers the event, explain and critic calls from the prompts it is given."""

    def __init__(self):
        self.calls: list[str] = []

    def __call__(self, *, purpose, user, **_):
        self.calls.append(purpose)
        if purpose == "event":
            return dict(EVENT), 0.0012
        if purpose == "explain":
            companies = []
            for block in user.split("\n\n")[1:]:
                cid = re.search(r"Company id=(\S+)", block).group(1)
                ev = [int(i) for i in re.findall(r"\[E(\d+)\]", block)]
                claims = [{"text": f"{cid} depends on Alpha Foundry.", "evidence_ids": ev[:1]}]
                if not ev:
                    claims = [{"text": f"{cid} competes with Alpha Foundry.", "evidence_ids": []}]
                companies.append({"id": cid, "rationale": f"{cid} is exposed to Alpha Foundry.", "claims": claims})
            return {"summary": "Impact concentrates on Beta Chips.", "companies": companies}, 0.002
        if purpose == "critic":
            claims = re.split(r"^(?=\d+\. Claim:)", user, flags=re.M)[1:]
            verdicts = [{"index": i, "supported": "(no evidence cited)" not in c,
                         "issue": "" if "(no evidence cited)" not in c else "no quote cited"}
                        for i, c in enumerate(claims)]
            return {"verdicts": verdicts}, 0.001
        raise AssertionError(purpose)


@pytest.fixture
def fake_llm(monkeypatch):
    fake = FakeLLM()
    monkeypatch.setattr(llm, "json_call", fake)
    return fake


# --- discovery -------------------------------------------------------------------------------------------------


async def test_lists_tools_resource_template_and_prompt(client):
    tools = {t.name: t for t in (await client.list_tools()).tools}
    assert set(tools) == {"trace_headline", "get_company_links", "explain_path", "list_examples"}
    assert all(t.output_schema for t in tools.values())  # JSON outputs with a published schema
    assert tools["get_company_links"].annotations.read_only_hint
    assert tools["trace_headline"].input_schema["properties"]["max_hops"]["maximum"] == 3
    templates = (await client.list_resource_templates()).resource_templates
    assert [t.uri_template for t in templates] == ["company://{ticker}"]
    prompts = (await client.list_prompts()).prompts
    assert [p.name for p in prompts] == ["assess_headline_exposure"]


# --- trace_headline --------------------------------------------------------------------------------------------


async def test_trace_new_headline_calls_llm_once_then_uses_cache(client, fake_llm):
    first = await client.call_tool("trace_headline", {"headline": NEW_HEADLINE})
    assert not first.is_error
    out = first.structured_content
    assert out["cached"] is False and out["ai_cost_usd"] == pytest.approx(0.0012)
    assert fake_llm.calls == ["event"]
    companies = {c["id"]: c for c in out["companies"]}
    beta = companies["BETA"]
    assert beta["direction"] == "hurt" and beta["hop"] == 1 and beta["rank"] == 1
    link = beta["paths"][0]["links"][0]
    assert link["statement"] == "Alpha Foundry supplies Beta Chips"
    assert link["citations"][0]["quote"] == "Alpha Foundry is our sole source of wafers."
    assert link["citations"][0]["source"] == "BETA 10-K, 2026-02-01"
    assert companies["DLTA"]["direction"] == "helped"
    assert companies["DLTA"]["paths"][0]["links"][0]["status"] == "curated"
    assert companies["DLTA"]["paths"][0]["links"][0]["citations"] == []

    again = await client.call_tool("trace_headline", {"headline": NEW_HEADLINE})
    assert again.structured_content["cached"] is True and again.structured_content["ai_cost_usd"] == 0
    assert again.structured_content["run_id"] == out["run_id"]
    assert fake_llm.calls == ["event"]  # the cache answered


async def test_trace_respects_max_hops(client, fake_llm):
    full = (await client.call_tool("trace_headline", {"headline": DEMO_HEADLINE})).structured_content
    near = (await client.call_tool("trace_headline", {"headline": DEMO_HEADLINE, "max_hops": 1})).structured_content
    assert "GAMA" in {c["id"] for c in full["companies"]}
    assert {c["id"] for c in near["companies"]} == {"BETA", "DLTA"}
    assert all(len(p["links"]) <= 1 for c in near["companies"] for p in c["paths"])
    assert fake_llm.calls == []  # demo run is cached; re-scoring at a shorter reach is free


@pytest.mark.parametrize("headline", ["", "   ", "short"])
async def test_trace_rejects_empty_headline(client, fake_llm, headline):
    r = await client.call_tool("trace_headline", {"headline": headline})
    assert r.is_error and "headline is empty or too short" in r.content[0].text
    assert fake_llm.calls == []


async def test_trace_validates_inputs(client, fake_llm):
    r = await client.call_tool("trace_headline", {"headline": DEMO_HEADLINE, "max_hops": 4})
    assert r.is_error and "less than or equal to 3" in r.content[0].text
    r = await client.call_tool("trace_headline", {"headline": "x" * 601})
    assert r.is_error


async def test_trace_respects_daily_budget(client, fake_llm, monkeypatch):
    monkeypatch.setattr(llm, "spent_today", lambda: 99.0)
    r = await client.call_tool("trace_headline", {"headline": "Strike closes Beta Chips assembly lines"})
    assert r.is_error and "daily AI budget" in r.content[0].text
    assert fake_llm.calls == []
    cached = await client.call_tool("trace_headline", {"headline": DEMO_HEADLINE})
    assert not cached.is_error  # cached headlines still work when the budget is spent


async def test_trace_without_api_key_explains_how_to_fix(client):
    r = await client.call_tool("trace_headline", {"headline": "Cyberattack halts Gamma Devices shipments"})
    assert r.is_error and "ANTHROPIC_API_KEY" in r.content[0].text


# --- get_company_links -----------------------------------------------------------------------------------------


async def test_get_company_links_with_evidence(client, fake_llm):
    out = (await client.call_tool("get_company_links", {"ticker": "beta"})).structured_content
    assert out["company"]["name"] == "Beta Chips"
    assert out["counts"] == {"suppliers": 1, "customers": 1, "competitors": 0, "regions": 0, "commodities": 0}
    by_cat = {link["category"]: link for link in out["links"]}
    assert by_cat["suppliers"]["source_name"] == "Alpha Foundry"
    assert by_cat["suppliers"]["citations"][0]["quote"] == "Alpha Foundry is our sole source of wafers."
    assert by_cat["customers"]["target_name"] == "Gamma Devices"

    only = (await client.call_tool("get_company_links", {"ticker": "ALFA", "relation": "competitors"})).structured_content
    assert [link["target_id"] for link in only["links"]] == ["DLTA"]
    assert only["links"][0]["quality"] == "speculative" and only["links"][0]["note"] == "Both are pure-play foundries."
    assert fake_llm.calls == []  # database only


async def test_get_company_links_errors(client):
    r = await client.call_tool("get_company_links", {"ticker": "BETTA"})
    assert r.is_error and "Unknown ticker 'BETTA'" in r.content[0].text and "BETA Beta Chips" in r.content[0].text
    r = await client.call_tool("get_company_links", {"ticker": "  "})
    assert r.is_error and "ticker is empty" in r.content[0].text
    r = await client.call_tool("get_company_links", {"ticker": "BETA", "relation": "partners"})
    assert r.is_error


# --- explain_path ----------------------------------------------------------------------------------------------


async def test_explain_path_returns_quotes_and_critic_verdicts(client, fake_llm, graph):
    r = await client.call_tool("explain_path", {"run_id": graph, "ticker": "BETA"})
    assert not r.is_error, r.content
    out = r.structured_content
    assert out["path"]["chain"] == "Alpha Foundry -> Beta Chips"
    assert out["path"]["links"][0]["citations"][0]["quote"] == "Alpha Foundry is our sole source of wafers."
    assert out["rationale"] == "BETA is exposed to Alpha Foundry."
    assert out["claims"][0]["supported"] is True and out["claims"][0]["on_this_path"] is True
    assert out["claims"][0]["citations"][0]["source"] == "BETA 10-K, 2026-02-01"
    assert out["critic"]["claims"] == 3 and out["critic"]["supported"] == 2  # DLTA's curated claim is flagged
    assert fake_llm.calls == ["explain", "critic"]

    dlta = (await client.call_tool("explain_path", {"run_id": graph, "ticker": "DLTA"})).structured_content
    assert dlta["claims"][0]["supported"] is False and dlta["claims"][0]["issue"] == "no quote cited"
    assert fake_llm.calls == ["explain", "critic"]  # explanation is stored on the run


async def test_explain_path_without_generating(client, fake_llm, graph):
    with session() as s:
        s.get(Run, graph).explanation = None
        s.commit()
    r = await client.call_tool("explain_path", {"run_id": graph, "ticker": "GAMA", "generate_if_missing": False})
    out = r.structured_content
    assert not r.is_error and out["claims"] == [] and "generate_if_missing" in out["note"]
    assert out["path"]["chain"] == "Alpha Foundry -> Beta Chips -> Gamma Devices"
    assert fake_llm.calls == []


async def test_explain_path_errors(client, graph):
    r = await client.call_tool("explain_path", {"run_id": "nope", "ticker": "BETA"})
    assert r.is_error and "Unknown run_id 'nope'" in r.content[0].text
    r = await client.call_tool("explain_path", {"run_id": graph, "ticker": "ALFA"})
    assert r.is_error and "not among the companies this run reached" in r.content[0].text
    r = await client.call_tool("explain_path", {"run_id": graph, "ticker": "BETA", "path_index": 3})
    assert r.is_error and "out of range" in r.content[0].text
    r = await client.call_tool("explain_path", {"run_id": graph, "ticker": "QQQQ"})
    assert r.is_error and "Unknown ticker" in r.content[0].text


# --- list_examples, resource, prompt ---------------------------------------------------------------------------


async def test_list_examples(client, fake_llm, graph):
    out = (await client.call_tool("list_examples", {})).structured_content
    demo = next(e for e in out["examples"] if e["run_id"] == graph)
    assert demo["headline"] == DEMO_HEADLINE and demo["event_type"] == "supply_disruption"
    assert demo["companies_reached"] == 3 and demo["hurt"] == 2 and demo["helped"] == 1
    assert demo["top_companies"][0].startswith("BETA -")
    assert all(e["run_id"] != pipeline.find_cached(NEW_HEADLINE).id for e in out["examples"])  # live runs excluded
    assert fake_llm.calls == []


async def test_company_resource(client):
    res = await client.read_resource("company://BETA")
    body = res.contents[0]
    assert body.mime_type == "application/json"
    assert '"name": "Beta Chips"' in body.text and '"suppliers": 1' in body.text
    with pytest.raises(MCPError, match="Unknown ticker"):
        await client.read_resource("company://NOPE")


async def test_prompt_template(client):
    p = await client.get_prompt("assess_headline_exposure", {"headline": DEMO_HEADLINE, "holdings": "BETA, GAMA"})
    text_ = p.messages[0].content.text
    assert DEMO_HEADLINE in text_ and "trace_headline" in text_ and "explain_path" in text_ and "BETA, GAMA" in text_


# --- database access -------------------------------------------------------------------------------------------


def test_server_connection_is_read_only():
    with ro_session() as s:
        assert s.execute(text("select count(*) from nodes")).scalar() > 0
        with pytest.raises(OperationalError, match="readonly"):
            s.execute(text("delete from nodes"))
