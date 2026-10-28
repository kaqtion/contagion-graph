import type { ReactNode } from "react";

export const metadata = { title: "Method · Contagion Graph" };

const AGENTS = [
  ["Extractor", "Offline, per filing", "Reads relationship-dense passages of each 10-K / 20-F / 40-F and returns (subject, relation, object, strength, quote). Any quote not found verbatim in the filing is dropped."],
  ["Entity resolver", "Offline", "Maps raw names (“Taiwan Semi”, “TSMC”, “2330.TW”) to one node with an alias table, tickers and fuzzy matching. Names it can't match go to the review queue."],
  ["Event parser", "Online, per headline", "Classifies the headline into a fixed taxonomy (supply disruption, regional disaster, demand shock, commodity, sanctions, …) with origin, region, commodity, severity and duration."],
  ["Graph navigator", "Online", "Walks up to three hops with a fixed template per event type, never a free-form query. Supply links keep one direction per path; competitor links end a path."],
  ["Impact scorer", "Online", "Plain Python implementing the formula below. The same graph and event always give the same ranking."],
  ["Explainer", "Online", "GraphRAG: retrieves the source quote for every edge on the top paths and writes a cited rationale for each of the top ten companies."],
  ["Critic", "Online, before output", "Checks every claim against the quotes it cites, and flags links with no quote, evidence over 18 months old or weak strength as speculative. They are shown, not hidden."],
];

const SYMBOLS = [
  ["Sₑ", "Event severity", "Event parser, 1–5, scaled to 0–1"],
  ["w_uv", "Edge strength", "Disclosed revenue share when given (≥40% → 0.9, ≥10% → 0.6, else 0.3); otherwise tier: sole 0.9, major 0.6, minor 0.3"],
  ["s_uv", "Edge sign", "+1 supplier/customer/region/commodity use; −1 competitor or commodity producer (they benefit)"],
  ["λ", "Hop decay", "0.5 per extra hop"],
  ["f_fresh", "Evidence freshness", "1.0 under 12 months, then halves every 12 months"],
  ["polarity", "Event direction", "−1 for bad news, +1 for good news, so a negative score means hurt"],
];

export default function MethodPage() {
  return (
    <article className="max-w-3xl w-full mx-auto px-4 sm:px-6 py-8 space-y-10 text-[14.5px] leading-7 text-muted">
      <header className="space-y-3">
        <h1 className="text-[28px] font-semibold tracking-tight text-text">How Contagion Graph works</h1>
        <p>
          Plain RAG retrieves documents; this retrieves consequences. An offline loop turns SEC filings into a graph of evidence-backed links. An online
          loop takes a headline, finds where it lands in the graph, traces exposure up to three hops out, scores it, and explains every path with the
          filing sentence behind it.
        </p>
      </header>

      <Section title="The seven agents">
        <div className="border border-line rounded-lg overflow-hidden">
          {AGENTS.map(([name, when, what]) => (
            <div key={name} className="grid sm:grid-cols-[160px_1fr] gap-x-4 px-4 py-3 border-b border-line last:border-0 bg-panel">
              <div>
                <div className="text-text font-medium text-[14px]">{name}</div>
                <div className="text-[11.5px] text-faint">{when}</div>
              </div>
              <p className="text-[13.5px] leading-6">{what}</p>
            </div>
          ))}
        </div>
        <p className="text-[13px]">LLMs handle language: extraction, event parsing, explanation, claim checking. Graph traversal and arithmetic are deterministic code.</p>
      </Section>

      <Section title="Exposure score">
        <div className="bg-panel border border-line rounded-lg px-4 py-4 overflow-x-auto">
          <p className="num text-text text-[14px] whitespace-nowrap">
            Impact(c) = Sₑ · polarity · Σ<sub>p ∈ paths(o→c)</sub> ( Π<sub>(u,v) ∈ p</sub> w<sub>uv</sub> · s<sub>uv</sub> ) · λ<sup>|p|−1</sup> · f<sub>fresh</sub>(p)
          </p>
        </div>
        <table className="w-full text-[13px]">
          <tbody>
            {SYMBOLS.map(([s, m, how]) => (
              <tr key={s} className="border-t border-line align-top">
                <td className="num text-text py-2 pr-3 whitespace-nowrap">{s}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-text">{m}</td>
                <td className="py-2">{how}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-[13px]">
          Paths are pruned with a beam (the 40 strongest partial paths per hop, at most 3 per company) and a minimum path weight of 0.02, so hubs like
          Apple don’t explode into thousands of nodes. A company named as the origin is scored directly, and other paths don’t route through it, so it
          is never counted twice.
        </p>
      </Section>

      <Section title="Evidence policy">
        <ul className="list-disc pl-5 space-y-1.5">
          <li><b className="text-text">Quoted</b>: the link comes from a filing sentence that was found verbatim in the source document.</li>
          <li><b className="text-text">Curated</b>: a widely reported link that filings don’t name (for example, Apple does not name TSMC in its 10-K). It is shown with a dotted line and always counts as speculative.</li>
          <li><b className="text-text">Stale</b>: evidence older than 18 months is kept but marked speculative, and its weight decays.</li>
          <li><b className="text-text">Coverage</b>: each company shows how much of its network is backed by filings. “No known path” means unknown, not unexposed.</li>
        </ul>
      </Section>

      <Section title="Limits">
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Most supplier relationships are never disclosed, so the graph is always incomplete. US filers must name customers above 10% of revenue; private and non-US firms disclose far less.</li>
          <li>Edge weights are usually tiers, not measured shares. Treat scores as a ranking, not a forecast of price moves.</li>
          <li>Annual filings lag reality by up to a year. Freshness decay and curated links reduce this but don’t remove it.</li>
          <li>Macro and rate events have no origin in a supply graph and are not traced in this version.</li>
          <li>Back-tests use today’s graph on past events, so they have look-ahead bias. They show the method works, not what it would have earned.</li>
        </ul>
      </Section>

      <Section title="Data and cost">
        <p>
          Filings come from SEC EDGAR, live headlines from GDELT, and prices for back-tests from Yahoo Finance. Extraction runs once through the Message
          Batches API on Claude Haiku. Each new headline makes three small model calls (parse, explain, critic), costing about a fifth of a cent. Results are
          cached, so reopening a trace is free. A daily budget and per-device rate limit protect the public demo.
        </p>
      </Section>

      <p className="text-[12.5px] text-faint border-t border-line pt-4">
        Not financial advice. This tool describes known supply-chain relationships. It does not make buy or sell recommendations.
      </p>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[18px] font-semibold text-text tracking-tight">{title}</h2>
      {children}
    </section>
  );
}
