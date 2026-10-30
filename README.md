# Contagion Graph

Paste a headline and see which companies get hurt or helped, through which supplier, customer, competitor,
region and commodity links, and how badly. The filing sentence behind every link is shown with the result.

Plain RAG retrieves documents; this retrieves consequences. An offline loop turns SEC filings into a graph of
evidence-backed links. An online loop parses each headline, traces it up to three hops through that graph,
scores every company with a deterministic formula, and explains the top paths with citations. A critic agent
checks each cited claim before the result is shown.

```
offline:  EDGAR 10-K/20-F ─► passage filter ─► Extractor (Claude, Batch API) ─► verbatim-quote check
          ─► Entity resolver ─► graph (Postgres) + curated seed links

online:   headline ─► Event parser ─► origins ─► Navigator (templates) ─► Scorer (Python)
          ─► Explainer (GraphRAG over edge quotes) ─► Critic ─► UI
```

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router), Tailwind v4, Cytoscape.js |
| API | FastAPI, served as a Vercel Python function at `/api/py/*` |
| Graph + evidence | Postgres on Neon (SQLite locally); traversal in Python, in memory |
| LLM | Claude Haiku 5.5 for extraction (Batch API), event parsing, explanation and critic |
| Data | SEC EDGAR, GDELT + Google News (live headlines), Yahoo Finance (back-tests) |

## Run locally

Requires Python 3.12 and Node 20+.

```bash
uv venv .venv --python 3.12
uv pip install --python .venv/Scripts/python.exe -r requirements-dev.txt   # macOS/Linux: .venv/bin/python
npm install
```

Create `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
SEC_USER_AGENT=Your Name you@example.com
CG_ADMIN_TOKEN=pick-a-secret
```

Start both servers (two terminals):

```bash
npm run dev:api     # FastAPI on :8000
npm run dev         # Next.js on :3000 (proxies /api/py to :8000)
```

The repo ships with a built graph in `data/contagion.db`, so this works without rebuilding anything.

## Build the graph from scratch

```bash
python -m scripts.build_universe        # companies, aliases, regions, commodities
python -m scripts.fetch_filings         # latest annual report per SEC filer (~60 MB, not committed)
python -m scripts.extract estimate      # cost estimate, no spend
python -m scripts.extract submit        # one Batch API job for all filings (~$0.15 on Haiku)
python -m scripts.extract collect       # waits, then verifies every quote against the filing
python -m scripts.load_graph            # resolve names, build edges, apply curated links + reviews
python -m scripts.seed_demos --explain  # worked examples on the home page
python -m scripts.backtest --llm        # event study on 5 historical shocks
python -m pytest tests
```

Extraction results are saved in `data/extracted/*.json`, so `load_graph` can be rerun for free.

## Deploy (Vercel + Neon, free tiers)

1. Push this folder to a GitHub repository.
2. The repo is linked to a Neon project (`neon.ts`, `.neon`). `neon env pull` writes `DATABASE_URL` (pooled)
   and `DATABASE_URL_UNPOOLED` (direct) into `.env.local`. `CG_DB=sqlite` in `.env.local` keeps local
   graph-building on `data/contagion.db`.
3. Copy the local database into Neon (uses the direct endpoint): `python -m scripts.sync_db`
4. In [Vercel](https://vercel.com), import the repository (framework: Next.js) and add these environment variables:
   - `DATABASE_URL`: Neon's **pooled** connection string (host contains `-pooler`)
   - `DATABASE_URL_UNPOOLED`: Neon's direct connection string, used only to create tables
   - `ANTHROPIC_API_KEY`: your key
   - `CG_ADMIN_TOKEN`: a secret for `/review`
   - optional: `CG_DAILY_BUDGET_USD` (default 0.20), `CG_RUNS_PER_IP_PER_HOUR` (default 8), `CG_DEMO_PASSCODE`
5. Deploy. `/api/py/health` reports the database, graph size and today's AI spend.

Without `DATABASE_URL`, the deployment still runs from a read-only copy of the bundled SQLite snapshot. New runs
then won't persist between serverless instances.

## Cost guardrails

Each new headline makes three small Haiku calls (parse, explain, critic), about $0.002 in total. Results are
cached per headline and per run, so opening an example or a shared link is free. A global daily budget
(`CG_DAILY_BUDGET_USD`) and a per-device hourly limit stop the public demo from draining the key. Set
`CG_DEMO_PASSCODE` to restrict new headlines to people you give it to.

## Pages

- **Console** (`/`, `/run/:id`): headline in, staged pipeline, radial contagion graph, ranked exposure and a path drawer with quotes, critic marks and the score math.
- **Portfolio** (`/portfolio`): holdings (kept in the browser) overlaid on any traced event.
- **Explorer** (`/explorer`): every company's suppliers, customers, competitors and evidence.
- **Backtest** (`/backtest`): predicted impact against 5-day market-adjusted returns, compared with baselines.
- **Method** (`/method`): agents, formula, evidence policy and limits.
- **Review** (`/review`, admin token): reject speculative links; decisions survive rebuilds.

Not financial advice.
