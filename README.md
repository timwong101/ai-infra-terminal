# AI Infrastructure Terminal

A responsive, evidence-first research dashboard for exploring the AI infrastructure ecosystem. It combines mock research workflows with real SEC filings and official investor-relations documents.

## Included

- Interactive AI infrastructure theme map
- Research tabs and selected-theme state
- Unified SEC and IR evidence-review workspace
- Persistent accept/reject review states and provenance records
- Grounded company comparisons with inline citations and saved evidence packets
- Responsive desktop and mobile layouts
- Live SEC and investor-relations ingestion health
- Real SEC filing metadata with permanent EDGAR source links
- On-demand SEC filing content extraction with citation-ready passages
- Evidence Detail drawer with section provenance, copy controls, and original filing links
- Evidence-backed thesis alerts with review, watch, and dismiss workflows
- Claim impact scores and historical thesis-drift snapshots
- Date-aware domestic and foreign-private issuer reporting regimes
- Official IR press release, presentation, earnings release, and shareholder-letter feeds
- Page-numbered IR document extraction with topic-classified evidence passages

## Stack

- React 19
- TypeScript
- Tailwind CSS 4
- Next.js-compatible App Router via vinext
- Lucide icons
- PostgreSQL with Drizzle ORM

## Run Locally

Node.js 22.13 or newer and pnpm are required.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## SEC Filing Refresh

The checked-in SEC cache keeps the dashboard usable without a backend. Add your identifying user agent to the ignored `.env.local` file:

```bash
SEC_USER_AGENT="AI Infra Terminal your-email@example.com"
```

The dashboard requests fresh SEC filing metadata whenever the page loads. The server keeps a successful result in memory for five minutes so repeated reloads do not create unnecessary EDGAR traffic. If a refresh fails, the UI continues using the last successful checked-in cache and marks it as stale.

To update the checked-in fallback cache manually, run:

```bash
pnpm ingest:sec
```

Both refresh paths fetch the previous year of relevant filings for CoreWeave, Nebius, Applied Digital, and IREN. Per-company selection reserves capacity for recurring quarterly and annual reports before filling the remaining cache with event filings, so a busy 8-K or 6-K stream cannot remove the prior periods needed for temporal analysis. The manual command atomically updates `data/generated/sec-evidence.json`; failed company requests retain their previously cached records.

Form validation is date-aware. IREN is treated as a foreign private issuer through June 30, 2025 and a domestic issuer beginning July 1, 2025. Unexpected cross-regime forms are excluded and recorded as ingestion warnings.

## Investor Relations Refresh

The dashboard also refreshes official investor-relations pages on load through a separate cache and API. This source is isolated from SEC ingestion so a company-site outage cannot degrade filing evidence.

To update the checked-in IR fallback cache manually, run:

```bash
pnpm ingest:ir
```

The crawler only follows configured official company and issuer-CDN domains. It requires publication dates, rejects SEC mirrors and navigation links, classifies documents by type, scores research relevance, and deduplicates repeated cards across news, reports, and presentation pages.

Every refresh also upserts document metadata into Postgres. Unseen documents enter a durable extraction queue, and the browser starts one bounded extraction job after the metadata response so the dashboard is not blocked. Queue claims rotate across all configured companies before using spare capacity, preventing one publisher from starving the others. Jobs use `pending`, `processing`, `completed`, and `failed` states, recover interrupted work after 30 minutes, and retry transient failures up to three times with a one-hour delay. Stale unextracted catalog rows are removed while completed historical documents remain durable. The ingestion bar reports extracted and queued totals.

## IR Document Evidence

Select an official IR row in the Evidence Feed to open its document detail. PDF documents are extracted page by page and HTML releases are parsed deterministically. Passages are grouped into capacity, revenue, capital spending, power, customers, financing, guidance, and risk topics. PDF citations retain their source page and open the official document at that page. IREN's issuer CDN does not reliably permit automated document retrieval, so those records retain their unique original provenance but open as explicitly limited catalog-only details linked to the accessible official IREN page; the system never invents passages from catalog metadata.

Backfill every configured company's checked-in IR catalog with:

```bash
pnpm db:backfill:ir
```

Add `--company=nebius` (or another configured company ID) to narrow the backfill, or add `--force` after changing IR extraction rules.

Process one queued document manually with `pnpm db:process:ir`, or use `pnpm db:process:ir -- --all` to drain the current queue in fair company rotation. Newly discovered document details are resolved from the Postgres catalog, so they do not need to exist in the checked-in JSON file before their citations can be opened.

## Filing Evidence Extraction

Select any real SEC row in the Evidence Feed to open its filing detail. The server downloads the primary EDGAR document, removes non-content markup, identifies relevant filing sections, and returns bounded passages with exact source metadata. Extracted results are cached in server memory for 24 hours, while concurrent requests for the same filing share one upstream SEC request.

Extraction is deterministic and does not generate or paraphrase claims. The original filing remains available from every detail view so passages can be verified at the source.

## Evidence Review And Comparison Memos

The **Evidence Feed** workspace materializes extracted SEC and IR passages into one deduplicated Postgres catalog. Each record retains the company, topic, source type, document date, section, exact excerpt, original URL, optional PDF page, quality score, and analyst review state. Filing signatures, cover-page fields, exhibit listings, and other administrative boilerplate are excluded before passages reach the review queue.

Only evidence explicitly marked `accepted` is eligible for comparison memos. Filters support company, topic, source family, review state, and full-text matching; visible results can be reviewed individually or in a batch. Rejected passages remain auditable but are excluded from generation. To keep every configured company usable on first run, evidence synchronization system-accepts a baseline of three high-quality official passages per company when fewer than three accepted records exist. The records carry a visible system-baseline review note, prefer different documents and topics, and never override an analyst rejection.

The **Memos** workspace compares two companies using Postgres full-text retrieval plus optional pgvector similarity. With `OPENAI_API_KEY`, the AI SDK creates a structured draft; without one, the deterministic grounded engine remains fully usable. Both paths reject unsupported or cross-company citations before saving. Confidence combines evidence quality, source diversity, company coverage, balance, and recency. Each memo stores the prompt, model, engine, token usage, verification result, and exact evidence snapshot, so later changes do not silently rewrite research history.

The **Theses** workspace is a durable claim ledger. Accepted evidence and material filing changes link to capacity, demand, funding, customer, and execution claims, with weighted impact scores and chronological history. Reviewing evidence immediately rebuilds the affected thesis state and creates alerts for meaningful new support or contradiction.

The **Companies** workspace turns that source catalog into quarter-over-quarter company intelligence. Periodic SEC filings use their official period of report, while explicit IR labels such as `Q3 FY26` and nearby earnings materials are resolved into persisted earnings packages. Publication date remains separate, annual results never compare against quarterly figures, and ambiguous news is visibly retained as a lower-confidence calendar fallback. Each package records its resolution method, confidence, source documents, and extraction status. Deterministic extraction captures only stated metrics such as revenue, backlog, contract value, liquidity, debt, GPU count, and active or planned power capacity; every value and disclosure change retains its exact source excerpt and URL. Persisted earnings change briefs organize those comparisons into what changed, bull implications, bear implications, and open questions. Factual brief claims require same-company evidence IDs, while confidence combines period resolution, evidence quality, source diversity, and comparison coverage. Content-addressed versions survive intelligence rebuilds, preserving prior thesis-impact results whenever the underlying evidence changes.

Rebuild reporting periods, earnings packages, normalized metrics, material comparisons, and cited change briefs from the durable evidence catalog with:

```bash
pnpm research:intelligence
```

The scheduled research cycle performs this step automatically after SEC and IR evidence synchronization, so opening the site reads persisted intelligence instead of refetching and recomputing every document.

The **Operations** workspace shows ingestion queue health, durable pipeline runs, and a company-flow coverage matrix. Each configured company is checked independently for ingestion, research evidence, alerts, five thesis claims, comparable-period intelligence, and memo eligibility. Run the complete SEC, IR, evidence, embedding, and thesis pipeline locally with `pnpm research:cycle`. The included GitHub Actions workflow can run it every six hours after `DATABASE_URL`, `SEC_USER_AGENT`, and optionally `OPENAI_API_KEY` are added as repository secrets. The database URL must point to a hosted Postgres instance reachable from GitHub Actions.

AI settings are optional:

```env
OPENAI_API_KEY=""
AI_MEMO_MODEL="gpt-5-mini"
AI_EMBEDDING_MODEL="text-embedding-3-small"
SCHEDULE_SECRET="replace-with-a-long-random-value"
```

## PostgreSQL Evidence History

Postgres persistence is optional during UI development and required for durable filing history. Without `DATABASE_URL`, the app still extracts the current and prior filing on demand and keeps results in the server session cache.

For a local database, install Docker and run:

```bash
docker compose up -d
pnpm db:setup
```

`pnpm db:setup` applies the versioned schema and backfills SEC filings, historical changes, and Nebius IR document passages from the checked-in metadata caches. You can also point `DATABASE_URL` at any hosted Postgres database and run the same command.

Future `pnpm ingest:sec` runs automatically persist newly discovered filing evidence when `DATABASE_URL` is configured. Ingestion is idempotent: existing filings are reused and only missing documents are downloaded.

Use `pnpm db:refresh` after changing extraction rules to reprocess all cached filings and replace their persisted sections and comparisons.

Alert generation runs automatically after SEC backfills and refreshes. Run `pnpm db:alerts` directly when changing claim or classification rules. Existing workflow states are preserved when passage-level changes are consolidated into refreshed section alerts.

The Evidence Detail drawer uses form-aware policies: event filings become standalone event signals, periodic reports compare recurring analytical sections, and amendments compare against their base filings. Language that is merely not repeated remains neutral and does not affect thesis alerts.

The **Alerts** workspace converts those changes into a review queue. Alerts can be filtered by company, category, significance, and workflow status, then opened directly into the filing comparison. Five tracked claims per company connect evidence to capacity growth, AI demand, funding risk, customer concentration, and execution risk. Claim scores are snapshotted by filing date so historical thesis drift remains visible instead of being overwritten.

## Verify

```bash
pnpm build
pnpm test
```

There is intentionally no authentication or live market-price integration in this version. SEC and investor-relations evidence is real, while AI generation is optional and always constrained by the saved evidence packet. Several broader research-source integrations and overview metrics remain mock while the research model is refined.
