# AI Infrastructure Terminal

A responsive, evidence-first research dashboard for exploring the AI infrastructure ecosystem. Its live Neocloud coverage combines real SEC filings, official investor-relations documents, durable analyst review, and grounded research workflows.

## Included

- Interactive AI infrastructure theme map
- Workflow-based navigation with contextual Monitor, Research, Analysis, and System tools
- Accessible dense-dashboard type scale, high-contrast metadata, custom scrollbars, and responsive tablet/mobile layouts
- Unified SEC and IR evidence-review workspace
- Persistent accept/reject review states and provenance records
- Grounded company comparisons with inline citations and saved evidence packets
- Streaming research assistant with saved question history, source filters, claim checks, and inline citations
- Durable Research Quality benchmarks with retrieval, citation, groundedness, refusal, latency, token, and cost diagnostics
- Live event intelligence combining official issuer updates with GDELT discovery signals
- Point-in-time research replay with strict availability policies and leakage checks
- Interactive source-to-evidence-to-claim lineage with a compliance-only mode
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

## Workspace Organization

The terminal keeps five stable primary destinations in the sidebar. **Overview** contains the infrastructure map and a concise Neocloud coverage summary. **Monitor** groups alerts and live events. **Research** groups companies, evidence review, theses, and lineage. **Analysis** groups grounded questions, comparison memos, and point-in-time replay. **System** groups research activity, quality benchmarks, and the attributed audit trail. Existing deep links remain valid, while each workflow exposes only its relevant local tools.

## Stack

- React 19
- TypeScript
- Tailwind CSS 4
- Next.js-compatible App Router via vinext
- Lucide icons
- PostgreSQL with Drizzle ORM

## Authentication And Workspaces

The terminal uses database-backed sessions with GitHub OAuth. Research artifacts are isolated by workspace, and each membership has a `viewer`, `analyst`, or `admin` role. Viewers can inspect research; analysts and admins can review evidence, update thesis state, run research workflows, and create memos. Generated artifacts and analyst decisions retain owner or reviewer attribution in the workspace audit trail.

Create a GitHub OAuth app whose callback URL is `http://localhost:3000/api/auth/github/callback`, then add these values to `.env.local`:

```env
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
AUTH_BASE_URL="http://localhost:3000"
ENABLE_DEMO_AUTH="true"
```

`AUTH_BASE_URL` should be the public application origin in deployed environments. The seeded portfolio demo is enabled automatically during local development and end-to-end tests; production requires the explicit `ENABLE_DEMO_AUTH=true` opt-in.

## Run Locally

Node.js 22.13 or newer and pnpm are required.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

The root URL resolves to `/login`. Successful authentication opens `/home`, while protected deep links preserve their destination through the login flow.

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

The **Evidence Review** workspace materializes extracted SEC and IR passages into one deduplicated Postgres catalog. Each record retains the company, topic, source type, document date, section, exact excerpt, original URL, optional PDF page, analyst review state, and a deterministic quality assessment. The quality engine scores materiality, specificity, AI-infrastructure relevance, and boilerplate risk, groups repeated passages, and explains each score so analysts can audit the policy instead of trusting an opaque rank.

Quality scores are triage signals, not approval. The system proposes a company thesis claim and impact for relevant passages, but the link is not used in thesis scoring until an analyst explicitly accepts or reassigns it. Rejected suggestions remain visible for audit. Filters expose high-value passages, pending links, boilerplate, duplicates, and the complete catalog. To keep every configured company usable on first run, synchronization system-accepts a baseline of three quality-eligible official passages per company when fewer than three accepted records exist. These records carry a visible system-baseline note, prefer different documents and topics, and never override an analyst decision.

Only accepted evidence above the memo quality floor is eligible for retrieval. The **Memos** workspace compares two companies using Postgres full-text search plus optional pgvector similarity. With `OPENAI_API_KEY`, the AI SDK creates a structured draft; without one, the deterministic grounded engine remains fully usable. Both paths reject unsupported or cross-company citations before saving. Confidence combines evidence quality, source diversity, company coverage, balance, and recency. Each memo stores the prompt, model, engine, token usage, verification result, and exact evidence snapshot. If cited evidence is rejected, falls below policy, changes content, or disappears, the saved memo is marked stale and offers regeneration instead of silently presenting outdated research.

The **Theses** workspace is a durable claim ledger. Accepted evidence and material filing changes link to capacity, demand, funding, customer, and execution claims, with weighted impact scores and chronological history. Reviewing evidence immediately rebuilds the affected thesis state and creates alerts for meaningful new support or contradiction.

The **Research Assistant** answers free-form questions across one or more Neocloud companies using only analyst-accepted evidence above the same quality floor as comparison memos. Company, topic, SEC/IR source, and date filters are applied during retrieval rather than after generation. Each factual claim must cite an evidence ID owned by the same company; invalid, missing, and cross-company citations are rejected before the verified markdown is streamed to the browser. Answers expose confidence, evidence quality, source diversity, claim-check status, and the exact source packet. Sessions and generation records are created before work begins, retain model and token metadata, and have durable `/research-assistant/:id` URLs. An analyst can turn a two-company question into a comparison memo or save a generated evidence gap as an open question in the thesis ledger.

The **Research Quality** workspace runs a versioned 32-case benchmark against that same retrieval, generation, and verification pipeline. Cases cover all four Neoclouds, expected topic retrieval, every pairwise capacity comparison, IR-only source policy, multi-company synthesis, and deliberate future-date questions that must refuse to answer. Every run persists metric breakdowns, failure reasons, latency, token and estimated-cost metadata, verified claims, and the exact evidence packet under a durable `/research-quality/:id` URL. The deterministic engine establishes a free reproducible baseline; the configured AI model can be evaluated separately.

Run the benchmark locally with `pnpm research:quality`. Add `-- --gate` to enforce the CI thresholds: at least 85 overall, at least 85% case pass rate, and 100% citation precision and groundedness. Optional `AI_QUALITY_INPUT_COST_PER_MILLION` and `AI_QUALITY_OUTPUT_COST_PER_MILLION` values enable model-cost estimates without hard-coding provider pricing.

With `OPENAI_API_KEY`, the research assistant uses structured AI generation before claim verification. Without a key, its deterministic engine still retrieves, scores, cites, streams, and saves grounded answers, keeping local and portfolio demos functional without model spend.

## Live Events, Replay, And Lineage

The **Live Event Intelligence** workspace normalizes recent official investor-relations updates and GDELT DOC 2.0 discoveries into a single Neocloud timeline. Events retain their source domain, publication time, event type, materiality, credibility, and proposed thesis impact. Official issuer items are marked as official; GDELT articles remain discovery signals and cannot enter memo retrieval or alter thesis scores until an official passage is extracted and accepted. The GDELT integration uses one bounded multi-company query with rate-limit retry, preserves stored events when the upstream service is unavailable, and deduplicates normalized URLs with content fingerprints.

Refresh events independently with:

```bash
pnpm research:events
```

The **Point-in-Time Research Replay** workspace freezes both historical and current evidence packets. `system-known` mode requires a passage to have been ingested and accepted by the selected cutoff. `publication-time` mode reconstructs material that had been published by that date using the current review policy. Every run rejects future-dated evidence, records leakage diagnostics, saves its grounded claims and citations, and explains which currently approved passages entered the packet later.

The **Claim-to-Evidence Lineage** workspace projects the existing relational model into an interactive graph: company to source, source to passage, passage or event to claim, and generated claim to memo. Company and node filters keep large graphs navigable. Compliance mode removes discovery-only events, rejected passages, stale artifacts, and unsupported claim paths instead of presenting them as trusted research.

The **Companies** workspace turns that source catalog into quarter-over-quarter company intelligence. Periodic SEC filings use their official period of report, while explicit IR labels such as `Q3 FY26` and nearby earnings materials are resolved into persisted earnings packages. Publication date remains separate, annual results never compare against quarterly figures, and ambiguous news is visibly retained as a lower-confidence calendar fallback. Each package records its resolution method, confidence, source documents, and extraction status. Deterministic extraction captures only stated metrics such as revenue, backlog, contract value, liquidity, debt, GPU count, and active or planned power capacity; every value and disclosure change retains its exact source excerpt and URL. Persisted earnings change briefs organize those comparisons into what changed, bull implications, bear implications, and open questions. Factual brief claims require same-company evidence IDs, while confidence combines period resolution, evidence quality, source diversity, and comparison coverage. Content-addressed versions survive intelligence rebuilds, preserving prior thesis-impact results whenever the underlying evidence changes.

Rebuild reporting periods, earnings packages, normalized metrics, material comparisons, and cited change briefs from the durable evidence catalog with:

```bash
pnpm research:intelligence
```

The scheduled research cycle performs this step automatically after SEC, IR, and live-event synchronization, so opening the site reads persisted intelligence instead of refetching and recomputing every document.

The **Activity & Briefings** workspace turns scheduled ingestion into an analyst inbox. Every research cycle records stage-level start, completion, duration, and failure events under a trace ID, then persists an immutable briefing covering evidence added since the previous successful run. Briefings summarize new SEC and IR documents, high-value passages, proposed thesis impacts, stale research, ingestion failures, and company-level source packets. The UI also retains briefing history, end-to-end company coverage, and the full pipeline timeline.

Run the complete SEC, IR, event, evidence, intelligence, embedding, thesis, and briefing pipeline locally with `pnpm research:cycle`. Build a lightweight snapshot of the current 24-hour evidence window with `pnpm research:briefing`, or pass a custom window such as `pnpm research:briefing 48`. The included GitHub Actions workflow runs the complete cycle every six hours after `DATABASE_URL`, `SEC_USER_AGENT`, and optionally `OPENAI_API_KEY` are added as repository secrets. The database URL must point to a hosted Postgres instance reachable from GitHub Actions.

AI settings are optional:

```env
OPENAI_API_KEY=""
AI_MEMO_MODEL="gpt-5-mini"
AI_RESEARCH_ASSISTANT_MODEL="gpt-5-mini"
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
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

GitHub Actions runs lint, the production build, all deterministic tests, and nine Chromium analyst journeys against an isolated pgvector/Postgres service. The browser coverage includes workflow navigation, responsive viewport containment, every Neocloud, evidence review and claim linking, thesis alerts, cited memo generation, Research Assistant persistence, quality benchmarks, live events, point-in-time replay, compliance lineage, workspace isolation, and attributed audit history.

To run that journey locally, create a dedicated database once and pass it explicitly. The fixture command refuses to truncate any database whose name does not end in `_e2e` or `_test`.

```bash
docker compose exec -T postgres createdb -U ai_infra ai_infra_e2e
E2E_DATABASE_URL="postgresql://ai_infra:ai_infra@localhost:5432/ai_infra_e2e" pnpm test:e2e
```

Company, theme, evidence-company, saved-memo, research-assistant session, replay, and lineage workspaces have durable URLs, so an analyst can reload or share a research view without losing its primary context.

There is intentionally no live market-price integration in this version. SEC and investor-relations evidence is real, while AI generation is optional and always constrained by the saved evidence packet. The infrastructure map labels Neoclouds as live coverage and treats every other theme as roadmap-only until official sources and company policies are integrated.
