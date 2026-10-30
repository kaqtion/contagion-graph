# Project progress

Where Contagion Graph stands as of 30 October 2026: what is built, what works, and what is left. For setup
and deploy steps, see [README.md](README.md).

## In one paragraph

You paste a news headline, for example "Earthquake halts TSMC fabs in Taiwan". The app works out what kind of
event it is, finds where it lands in a graph of company relationships built from SEC annual reports, and
follows the shock up to three hops through supplier, customer, competitor, region and commodity links. It
scores every company it reaches as hurt or helped, explains the strongest paths using the exact filing
sentences behind each link, and has a critic check every claim against its quote. A portfolio page applies
the result to your own holdings, and a backtest page checks the method against five real past shocks.

## Status at a glance

| Area | Status |
|---|---|
| Knowledge graph from SEC filings | Done |
| Seven-agent pipeline (extract, resolve, parse, navigate, score, explain, critique) | Done |
| Web app: console, portfolio, explorer, backtest, method, review queue | Done |
| Live news headlines (GDELT, with Google News fallback) | Done |
| Visual redesign | Done |
| Cloud database (Neon Postgres) | Done and synced |
| Code on GitHub (`kaqtion/contagion-graph`, private) | Done; ashmitdhown invited with write access |
| Public deploy on Vercel | **Not done.** Needs the repo owner to import it (see "What's left") |

## What is built

### 1. The knowledge graph (offline, already run)

- **Universe:** 146 companies across semiconductors, chip equipment, foundries, memory, materials, hardware,
  cloud, contract manufacturing, automakers and auto parts. They are listed in `data/universe.csv`.
- **Filings:** the latest 10-K, 20-F or 40-F for each company that files with the SEC, 116 filings in total.
  Relationship-dense passages are picked out before anything is sent to the AI model, which keeps the cost
  low.
- **Extraction:** Claude Haiku 5.5, run through the Batch API, reads those passages and returns relationships
  of the form subject, relation, object, strength and quote. **A relationship is kept only if its quote
  appears word for word in the filing.**
- **Entity resolution:** names like "Taiwan Semi", "TSMC" and "2330.TW" are matched to one company using
  aliases, tickers, legal-suffix stripping and fuzzy matching. Names that can't be matched become external
  nodes so their paths aren't lost.
- **Curated links:** 140 hand-written links in `data/curated_edges.csv` fill gaps that filings don't state,
  such as which customers are major. These are labelled "curated" in the UI. Where a filing quote and a
  curated link agree, the quote is kept and the stronger tier is used.
- **Result:** 1,224 links, 1,150 of them backed by verified filing quotes, 411 external companies, and 557
  companies in total. Each company has a coverage rating that shows how much of its network is backed by
  filings: 95 high, 37 medium, 12 low, 7 none.

### 2. The online pipeline (runs per headline)

| Step | What it does | AI? |
|---|---|---|
| Event parser | Classifies the headline into one of 10 event types and picks out severity (1–5), duration, polarity and the companies, regions or commodities hit | Yes |
| Origin locator | Matches those names to graph nodes | No |
| Navigator | Walks up to 3 hops using a fixed template per event type, keeping the top 40 paths per hop | No |
| Scorer | Applies the impact formula below. The same input always gives the same ranking | No |
| Explainer | Writes a cited explanation for the top 10 companies from the quotes on their paths | Yes |
| Critic | Checks each claim against its quote, and flags links that have no quote, are older than 18 months, or are weak | Yes, plus rule-based checks |

Impact = severity × polarity × Σ over paths of (Π link weight × strength) × 0.5^(hops − 1) × freshness.
Freshness starts falling once evidence is 12 months old.

### 3. The web app

Next.js on the frontend, FastAPI on the backend.

- **Console** (`/`): a landing page with a search box, live news headlines, the six worked examples and a
  how-it-works section. A trace shows the event card, a ranked exposure table and a radial graph coloured by
  hop. Clicking a company opens its paths with the filing quotes and the critic's verdicts.
- **Portfolio** (`/portfolio`): enter holdings, including ETFs, which are split into their constituents. It
  shows your exposure to any traced event. Holdings stay in your browser.
- **Explorer** (`/explorer`): browse every company with its suppliers, customers and competitors, and the quote
  behind each link.
- **Backtest** (`/backtest`): five historical shocks, comparing the graph's predictions with actual 5-day
  returns after subtracting the market (SPY) return, against three baselines.
- **Method** (`/method`): plain-language explanation of the agents and the formula.
- **Review** (`/review`): admin-only queue for approving or rejecting speculative links and unmatched names.
  Decisions survive a graph rebuild.

### 4. Cost protection

Built to keep the roughly $4 API credit lasting through demos:

- **Model:** all AI steps use Claude Haiku 5.5, the cheapest model.
- **Daily cap:** AI spending stops at $0.20 a day.
- **Rate limit:** 8 new traces per IP address per hour.
- **Optional passcode:** set `CG_DEMO_PASSCODE` to require it for new headlines.
- **Caching:** a headline that was already traced is reused.
- **Free demos:** the six worked examples are stored, so opening them is free.

**Total AI spend so far: about $0.16.**

## Results

### Worked examples (stored, free to open)

| Headline | Run |
|---|---|
| US expands export controls on chipmaking tools sold to China | `/run/0mfEJRZl` |
| Lithium prices spike as major supplier halts mine output | `/run/Ly0hnmQK` |
| Apple cuts iPhone production orders by 10% on weak demand | `/run/aTgGSbfm` |
| Nvidia warns data-center GPU shipments will slip a quarter | `/run/zp6HXJxQ` |
| Fire at Renesas Naka plant halts automotive chip production | `/run/jcRQQmIx` |
| Earthquake halts TSMC fabs in Taiwan for several weeks | `/run/r8Y7vyj6` |

### Backtest (5 historical events)

Hit rate is the share of flagged companies that did worse than the S&P 500 (SPY) over the next 5 days.

| Method | Average hit rate |
|---|---|
| Contagion graph | 70% |
| Same-sector peers | 66% |
| Whole universe | 60% |
| AI model from memory | 75% |

The graph beats the simple baselines. The AI-from-memory baseline scores higher, partly because these
events are well known and were likely in the model's training data. The graph's advantage is that every
prediction comes with a cited path, which the memory baseline cannot give.

## Recent changes

### Live news feed fixed

- **Problem:** the "Live news" dropdown was always empty. GDELT was rate-limiting the app (HTTP 429) and
  answering more slowly than the 8-second timeout.
- **Fix:** GDELT now gets 15 seconds, and if it fails the app falls back to Google News search, which is free
  and needs no key. Results are cached for 15 minutes. The change is in `contagion/api.py`.
- **Caveat:** Google's feed terms allow personal, non-commercial use. That is fine for a demo, but would need
  revisiting for a product.

### Visual redesign

- **Typography:** Instrument Serif for large headings, Geist for interface text, Geist Mono for numbers.
- **Look:** graphite background with a subtle grain texture, frosted-glass overlays, and a soft glow behind
  the graph. Amber is the only accent; the hurt and helped colours are unchanged.
- **Landing page:** a new hero ("Every headline has *a blast radius.*") with an animated diagram of a TSMC
  shock spreading three hops, an index of the worked examples, and a four-step how-it-works section. The old
  home page layout was broken: the heading was squeezed into a narrow column and the stats overlapped the
  footer.
- **Trace screen:**
  - The pipeline steps are a connected row that turns green as each step finishes.
  - The exposure filter is a segmented control.
  - The selected company row is highlighted.
  - The side panel is restyled, and the graph leaves room for its summary card and legend.
- **Every page:** consistent large serif headers, wider layouts and a new navigation bar with a live graph
  status.
- **Polish:**
  - Buttons give hover and press feedback.
  - Keyboard focus is shown with a visible outline, and there's a "Skip to content" link.
  - Animations switch off when the system asks for reduced motion.
  - Loading and error screens are styled.
  - Links shared on social media show a proper title and description.
- **Mobile:** no page scrolls sideways at phone width. The Method page's wide table now scrolls on its own.

## What's left

1. **Deploy to Vercel.** Import `kaqtion/contagion-graph` at vercel.com/new and set these environment
   variables: `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `ANTHROPIC_API_KEY` and `CG_ADMIN_TOKEN`. The values are
   in your local `.env.local`, which is deliberately not on GitHub. Then open the live URL and run one trace to
   check it works. The Python function on Vercel has not been tested yet.
2. **Set a real SEC contact.** In `.env.local`, `SEC_USER_AGENT` still uses the `admin@example.com` placeholder.
   The SEC asks for a real name and email. It only matters when re-fetching filings.
3. **Change the admin token.** `CG_ADMIN_TOKEN` is `change-me` locally. Pick a real secret before deploying,
   because it protects the review queue.
4. **Rebuild the graph every few months** so new supplier and customer relationships are picked up. Run
   `fetch_filings`, then `extract`, then `load_graph`, then `sync_db`. The original extraction cost about
   $0.13 in AI credit, so expect each rebuild to cost about that much.

## Known limits

- **The graph is a snapshot.** Events can be from today, but relationships are only as current as the last
  rebuild.
- **Coverage is limited.** Only the 146 tracked companies and the roughly 400 companies their filings name can
  be traced.
- **Scores are not price predictions.** They describe exposure through known links. Treat the backtest as a
  sanity check, not proof.
