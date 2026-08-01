# AI Infrastructure Research Terminal

[![CI](https://github.com/timwong101/ai-infra-terminal/actions/workflows/ci.yml/badge.svg)](https://github.com/timwong101/ai-infra-terminal/actions/workflows/ci.yml)

An evidence-grounded research workspace for investors tracking the AI infrastructure buildout. The terminal turns SEC filings and official investor-relations material into reviewable evidence, cited analysis, thesis history, and point-in-time research.

This is intentionally not a stock picker or price-prediction tool. The product is designed to help an analyst answer a more important question:

> What does the available evidence support, where did it come from, and what remains uncertain?

![AI Infrastructure Map](docs/ai-infrastructure-map.jpg)

## Why This Project

AI infrastructure research crosses compute, data centers, power, cooling, networking, and financing. The relevant facts are spread across filings, presentations, press releases, and changing company disclosures. A generic chatbot can summarize those documents, but it usually cannot show whether each claim is supported, whether the evidence was available at the time, or whether an analyst later rejected the source.

The terminal treats provenance as a product feature:

- Every factual research claim must cite saved evidence from the same company.
- Only analyst-accepted evidence above a quality floor enters research retrieval.
- Generated memos retain their exact evidence packet and become stale when that packet changes.
- Every newly extracted SEC or IR document retains an immutable, checksum-addressed raw source artifact.
- Discovery events cannot silently become trusted research.
- Historical replay checks that future information did not leak across the selected cutoff.
- Management commitments retain append-only revisions and are reconciled only to analyst-approved canonical facts.
- Analyst decisions and generated artifacts remain attributable in an audit trail.

The initial live coverage focuses on four Neocloud companies: **CoreWeave, Nebius, Applied Digital, and IREN**. The infrastructure map keeps the broader taxonomy visible while clearly distinguishing live research from planned coverage.

## Two-Minute Demo

1. Start the app and choose **Open portfolio demo**.
2. Open **Research → Evidence** to inspect real SEC and IR passages, quality signals, review state, and original sources.
3. Open **Analysis → Ask** to review a saved four-company answer with claim checks and inline citations.
4. Open **Analysis → Memos** for the cited CoreWeave vs. Nebius comparison and its frozen evidence packet.
5. Open **Research → Companies → Commitments** to inspect forward-looking targets, revisions, and outcome reconciliation.
6. Open **Analysis → Replay** to compare what the evidence supported on February 1, 2026 with what is accepted today.
7. Open **Research → Lineage** or **System → Audit** to trace generated claims back to sources and analyst actions.

The demo seeder is idempotent. It repairs missing portfolio artifacts, removes accidental empty research sessions, and reuses completed artifacts instead of creating duplicates:

```bash
pnpm demo:seed
```

It does not insert synthetic research evidence. The seeded memo, answer, benchmark, and replay are produced by the same application services used in normal workflows.

## What It Demonstrates

| Product capability | Engineering signal |
| --- | --- |
| SEC and official IR ingestion | Source-specific normalization, retry policy, caching, and idempotent persistence |
| Immutable source archive | S3-compatible content-addressed storage, SHA-256 verification, parser versioning, and deterministic replay |
| Real-document parser gate | Immutable SEC/IR benchmark corpus, expected-versus-actual diagnostics, fiscal-period checks, and controlled parser promotion |
| Evidence review | Human-in-the-loop workflow with durable decisions and provenance |
| KPI ledger and peer benchmark | SEC XBRL normalization, source conflict resolution, review state, and comparable time series |
| Guidance and commitments | Stable domain identity, bitemporal revisions, human review, and actual-versus-target reconciliation |
| Research Assistant | Grounded retrieval, structured generation, streaming UI, and citation verification |
| Comparison memos | Analyst-grade claim synthesis, numeric fidelity, frozen evidence packets, and stale-artifact detection |
| Published research reports | Immutable versions, public token URLs, compliance filtering, revocation, and export |
| Research Quality | Production failure capture, versioned regression cases, run comparison, and deterministic CI gates |
| Point-in-time replay | Temporal data modeling and explicit leakage checks |
| Claim-to-evidence lineage | Relational provenance projected into an interactive graph |
| Workspaces and roles | GitHub OAuth, database sessions, workspace-scoped evidence, claim, alert, and metric decisions, negative isolation tests, and RBAC |
| Collaborative review | Workspace invitations, claim-level comments, independent approval, and publish gates |
| Research operations | Scheduled pipelines, trace IDs, stage status, briefings, and failure visibility |
| Responsive terminal UI | Dense information design across desktop and mobile workflows |

## Architecture

```mermaid
flowchart LR
    SCHEDULE["API and scheduled triggers"] --> REDIS[("Redis / BullMQ")]
    REDIS --> WORKER["Durable research workers"]
    WORKER --> INGEST["Parallel ingest and processing stages"]
    SEC["SEC EDGAR"] --> ARCHIVE[("Immutable source artifacts")]
    IR["Official investor relations"] --> ARCHIVE
    ARCHIVE --> INGEST
    ARCHIVE --> SOURCEBENCH["Real-document parser benchmark"]
    SOURCEBENCH --> PARSERGATE["Parser release gate"]
    PARSERGATE --> INGEST
    XBRL["SEC Company Facts / XBRL"] --> METRICS["Normalized KPI ledger"]
    GDELT["GDELT discovery"] --> EVENTS["Discovery event pipeline"]

    INGEST --> DOCS[("Postgres documents and passages")]
    DOCS --> QUALITY["Evidence quality policy"]
    QUALITY --> REVIEW["Analyst review"]
    REVIEW --> SEARCH["Full-text and optional vector retrieval"]
    METRICS --> METRIC_REVIEW["Analyst metric review"]
    METRIC_REVIEW --> SEARCH
    REVIEW --> COMMITMENTS["Guidance and commitments"]
    METRIC_REVIEW --> OUTCOMES["Outcome reconciliation"]
    COMMITMENTS --> OUTCOMES

    SEARCH --> ASK["Research Assistant"]
    ASK --> FEEDBACK["Analyst failure reports"]
    FEEDBACK --> BENCH
    SEARCH --> MEMO["Comparison memos"]
    MEMO --> REPORT["Published reports"]
    SEARCH --> BENCH["Quality benchmarks"]
    SEARCH --> REPLAY["Point-in-time replay"]

    REVIEW --> THESES["Claims, alerts, thesis history"]
    EVENTS -. "proposal only" .-> THESES

    ASK --> LINEAGE["Lineage and audit"]
    MEMO --> LINEAGE
    REPORT --> LINEAGE
    REPLAY --> LINEAGE
    THESES --> LINEAGE
    WORKER --> OPS["Live operations control plane"]
    WORKER -. "OpenTelemetry spans" .-> OTEL["OTLP collector (optional)"]
```

The application is a TypeScript monolith with clear service boundaries. React workspaces call App Router API handlers; domain services own retrieval, verification, replay, ingestion, and persistence; PostgreSQL stores both research data and operational history.

Every workspace and detail view has an explicit App Router segment, so deep links, reloads, browser history, and unknown-route 404s use framework routing rather than a client-side catch-all. Large analysis workspaces are lazy-loaded behind a shared authenticated shell, and CI enforces entry-point and chunk-size budgets.

### Claim-To-Evidence Model

```mermaid
erDiagram
    COMPANY ||--o{ SOURCE_DOCUMENT : publishes
    SOURCE_DOCUMENT ||--o{ EVIDENCE : contains
    COMPANY ||--o{ METRIC_OBSERVATION : reports
    SOURCE_DOCUMENT ||--o{ METRIC_OBSERVATION : substantiates
    USER ||--o{ METRIC_OBSERVATION : reviews
    EVIDENCE }o--o{ CLAIM : supports
    CLAIM }o--o{ MEMO : appears_in
    USER ||--o{ EVIDENCE : reviews
    USER ||--o{ AUDIT_EVENT : performs
    WORKSPACE ||--o{ RESEARCH_SESSION : owns
    RESEARCH_SESSION ||--o{ RESEARCH_MESSAGE : contains
```

An evidence record retains the source document, exact excerpt, section, document date, original URL, optional PDF page, quality scores, review decision, reviewer, and timestamps. Its source document can reference immutable raw bytes, a SHA-256 checksum, and a versioned parser run. Generated outputs store evidence snapshots rather than relying on a future retrieval to reconstruct what the model saw.

A metric observation separately retains its reporting period, normalized value, unit, source method, XBRL taxonomy and concept when available, source URL, confidence, and analyst decision. Conflicting standardized financial facts are surfaced for resolution; scope differences such as facility-level capacity are not automatically mislabeled as conflicts.

The reviewer-oriented [architecture guide](docs/architecture/README.md) maps bounded contexts to code and records the key temporal-modeling decisions as ADRs.

## Grounding And Hallucination Controls

The same safety policy applies whether generation uses an OpenAI model or the deterministic local engine.

1. **Retrieval gate:** Only accepted evidence above the quality threshold is eligible. Company, topic, source, and date filters are applied during retrieval.

2. **Company-scoped citations:** A factual claim about CoreWeave cannot cite a Nebius passage. Unknown, missing, and cross-company citation IDs are rejected.

3. **Unsupported-claim removal:** Verification runs before an answer or memo is saved. Open questions can remain uncited; factual claims cannot.

4. **Claim-quality gate:** Memo claims must preserve disclosed numeric facts, retain meaningful lexical support, and label exact quotations correctly. Failed synthesis falls back to an exact source passage.

5. **Frozen evidence packets:** Memos, answers, quality cases, and replay runs persist the exact passages used to produce the output.

6. **Staleness propagation:** Rejecting or changing cited evidence marks affected research stale instead of silently leaving it current.

7. **Source-policy separation:** GDELT articles are discovery signals. They cannot enter memo retrieval or change thesis scores until official evidence is extracted and accepted.

8. **Temporal integrity:** Replay supports both publication-time reconstruction and the stricter system-known policy, then reports leakage diagnostics.

## Core Workflows

### Evidence To Thesis

SEC filings and IR documents are normalized into citation-ready passages. Deterministic scoring measures materiality, specificity, AI-infrastructure relevance, and boilerplate risk. Analysts can accept, reject, or reassign proposed claim links; those decisions rebuild thesis state and may create evidence-backed alerts.

### Evidence To Answer

The Research Assistant retrieves across one or more companies and returns a cited answer, confidence score, evidence quality, source diversity, open questions, and claim-check status. Sessions have durable URLs and retain prompt version, model, token use, latency, retrieval configuration, KPI snapshot, and the exact evidence packet.

### Production Failure To Evaluation

An analyst can report wrong retrieval, unsupported claims, citation mismatches, incorrect metrics, stale sources, missing evidence, incorrect answers, or failures to abstain directly from a saved answer. The report freezes the complete generation trace separately from the analyst's judgment. In the Quality workspace, the analyst records expected behavior and executable company scope, then promotes the issue into a versioned production regression case. Future benchmark runs combine the 32 curated cases with all active production cases; saved runs can be compared for regressions and fixes without adding another top-level workflow.

### Archived Source To Parser Release

The source extraction benchmark reparses immutable official documents from all four covered companies and scores structure, section taxonomy, metric recall and precision, false-positive guards, management commitments, and fiscal-period resolution. Each result retains the archived SHA-256 hash, parser version, replay diff, expected contract, and actual output. A parser candidate cannot be promoted unless every case passes, the overall score is at least 90, metric recall is at least 90%, and false-positive plus fiscal-period safety remain at 100%.

Local and portfolio runs use the eight-document real SEC/IR corpus. CI uses a deliberately smaller archived fixture to prove the same replay-and-gate contract without depending on external sites or checked-in proprietary source bytes.

### Evidence To Memo

The comparison workflow analyzes two companies with accepted evidence only. It supports Postgres full-text search plus optional pgvector similarity. A claim-quality layer removes repetition, rejects malformed source text, verifies numeric and quote fidelity, and measures lexical support. Failed synthesis uses a labeled exact-source fallback instead of presenting an unverified paraphrase. Each saved memo includes six balanced sections, inline citations, “why it matters” context, retrieval mode, generation engine, verification diagnostics, and a frozen source packet.

### Filing Facts To Peer Benchmark

Company Intelligence combines existing passage extraction with the SEC Company Facts API. XBRL facts are normalized to comparable units and stored as proposed observations; accepted passage-derived metrics remain durable across refreshes. Analysts can compare all four Neoclouds in a matrix, inspect source-linked history, accept or reject observations, and resolve true standardized-financial conflicts. Only accepted observations flow into memo and Research Assistant KPI snapshots or generate material-change alerts.

### Guidance To Outcome

The commitments ledger scans accepted evidence for explicit numeric forward-looking statements. Extraction creates proposed records; analysts confirm identity, scope, value, and target period before a commitment becomes trusted. Later statements are appended as reiterations, raises, reductions, delays, or updates with separate valid and recorded times. Accepted commitments can be reconciled to compatible canonical metrics, preserving the actual, variance, outcome classification, rationale, reviewer, and complete source history.

### Memo To Published Report

An analyst submits a memo to another workspace analyst or admin for independent review. Review comments can target the memo or a specific claim, unresolved comments block approval, and each decision is bound to a hash of the exact memo and evidence packet. Only an approved, non-stale snapshot can be published as an immutable, versioned report at a tokenized public URL. Every report includes reviewer sign-off, its evidence-as-of date, quality scores, frozen source appendix, publisher identity, and audit history. Published versions can be copied, exported to Markdown, printed to PDF, or revoked without rewriting prior snapshots.

### Evidence Through Time

Point-in-time replay reconstructs the eligible packet at an earlier date and compares it with the current packet. This makes thesis drift inspectable without pretending that an omitted filing passage was necessarily retracted.

### Pipeline To Analyst Inbox

The scheduled research cycle runs SEC, IR, live-event, evidence, intelligence, XBRL metric, embedding, thesis, and briefing stages. Each run records stage timing and failures under a trace ID. Upstream refresh and extraction belong to the independent worker; opening a page reads persisted snapshots and never initiates ingestion. Global pipeline controls require an administrator. The Activity workspace converts the result into a research briefing rather than forcing the analyst to inspect raw ingestion logs.

## Technology

| Layer | Choice |
| --- | --- |
| Frontend | React 19, TypeScript, Tailwind CSS 4, Lucide |
| Application | Next.js-compatible App Router via vinext |
| Database | PostgreSQL 17, pgvector, Drizzle ORM |
| Object storage | S3-compatible source archive, MinIO for local development |
| AI | Vercel AI SDK with optional OpenAI generation |
| Parsing | Cheerio for HTML, unpdf for page-aware PDF extraction |
| Visualization | Cytoscape for interactive lineage |
| Authentication | GitHub OAuth, database sessions, workspace RBAC |
| Jobs | Redis 7, BullMQ workers, bounded retries, dead-letter queue |
| Observability | Server-sent events, trace IDs, worker heartbeats, optional OpenTelemetry export |
| Testing | Node test runner, Playwright, deterministic research quality gate |
| Automation | GitHub Actions CI and six-hour ingestion workflow |

The deterministic engine keeps the complete product usable without an API key. An OpenAI key enables structured model generation, but all model output still passes through the same citation verifier.

## Engineering Decisions

### Evidence quality is not analyst approval

Scoring is a triage tool. It can prioritize specific, material passages and suppress boilerplate, but it does not replace analyst judgment. Review state is modeled separately and remains visible.

The same policy applies to numeric observations. Structured XBRL is high-confidence source data, but it is still proposed until an analyst accepts it. Evidence reviews, metric reviews, canonical selections, and custom thesis state are workspace-owned overlays on the shared source corpus. Review decisions survive transactional intelligence rebuilds without leaking into another workspace.

### Insufficient evidence is not unchanged

Earnings packages have an explicit readiness state. A package with no grounded comparison is `insufficient_evidence`; low-coverage or low-confidence packages are `review_required`. The terminal emits an `unchanged` thesis impact only after a comparable prior period and the minimum grounded evidence policy pass.

### Event discovery is not evidence

Fast news discovery is useful, but mixing it directly into trusted research would weaken provenance. Events can propose thesis impacts; official accepted passages are required to support them.

### Deterministic behavior is a feature

Local demos, tests, and CI should not depend on model availability or spend. Deterministic synthesis provides a reproducible baseline and makes AI-vs-baseline quality measurable.

### Generated research is durable data

Prompts, filters, evidence packets, model metadata, verification results, and ownership are persisted. A generated memo is an auditable artifact, not transient chat text.

### Missing repetition is not a change

Periodic filing comparisons are limited to recurring analytical sections. Event filings are treated as standalone disclosures, and language that simply does not reappear is not classified as a removal.

## Run Locally

### Prerequisites

- Node.js 22.13 or newer
- pnpm
- Docker Desktop

### Setup

```bash
git clone https://github.com/timwong101/ai-infra-terminal.git
cd ai-infra-terminal
pnpm install
cp .env.example .env.local
docker compose up -d
pnpm db:setup
pnpm demo:seed
pnpm worker:research
```

In a second terminal, start the web application:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The root URL resolves to `/login`; the portfolio demo requires no OAuth configuration. Docker Compose starts PostgreSQL, Redis, and MinIO. The web process accepts research jobs while the independent worker executes them, so queued work survives web-server restarts.

SEC asks automated clients to identify themselves. Replace the example value in `.env.local` with a real application name and contact email:

```env
SEC_USER_AGENT="AI Infra Terminal your-email@example.com"
DATABASE_URL="postgresql://ai_infra:ai_infra@localhost:5432/ai_infra"
REDIS_URL="redis://localhost:6379"
```

### Optional GitHub OAuth

Create a GitHub OAuth app with this callback URL:

```text
http://localhost:3000/api/auth/github/callback
```

Then configure:

```env
GITHUB_CLIENT_ID=""
GITHUB_CLIENT_SECRET=""
AUTH_BASE_URL="http://localhost:3000"
```

Research artifacts are isolated by workspace. Membership roles are `viewer`, `analyst`, and `admin`; mutating research workflows require analyst access.

### Optional AI Generation

```env
OPENAI_API_KEY=""
AI_MEMO_MODEL="gpt-5-mini"
AI_RESEARCH_ASSISTANT_MODEL="gpt-5-mini"
AI_EMBEDDING_MODEL="text-embedding-3-small"
AI_QUALITY_INPUT_COST_PER_MILLION="0"
AI_QUALITY_OUTPUT_COST_PER_MILLION="0"
```

Without `OPENAI_API_KEY`, memos and answers use the grounded deterministic engine.

## Data Operations

| Command | Purpose |
| --- | --- |
| `pnpm ingest:sec` | Refresh the checked-in SEC fallback cache and persist new filing metadata |
| `pnpm ingest:ir` | Refresh configured official IR sources |
| `pnpm db:backfill` | Extract and persist SEC filing evidence |
| `pnpm db:backfill:ir` | Backfill official IR document passages |
| `pnpm db:process:ir -- --all` | Drain the durable IR extraction queue |
| `pnpm artifacts:backfill` | Archive existing raw documents and isolate parser differences as reviewable previews |
| `pnpm research:intelligence` | Rebuild periods, earnings packages, metrics, and change briefs |
| `pnpm research:events` | Refresh official and GDELT event discovery |
| `pnpm research:briefing` | Build a briefing from the current research window |
| `pnpm research:cycle` | Run the complete research pipeline |
| `pnpm worker:research` | Run the durable BullMQ cycle and stage workers |
| `pnpm research:quality -- --gate` | Run the versioned benchmark and enforce CI thresholds |
| `pnpm research:metric-quality -- --gate` | Verify extraction fixtures, anomaly safety, dimensions, and live canonical-fact contracts |
| `pnpm research:extraction-quality -- --gate` | Replay immutable source documents and enforce parser-release thresholds |

SEC refreshes preserve recurring quarterly and annual coverage before newer event filings. IR ingestion only follows configured official domains, requires publication dates, rejects SEC mirrors, deduplicates repeated cards, and queues unseen documents for bounded retries.

The six-hour GitHub Actions ingestion workflow requires repository secrets for `DATABASE_URL` and `SEC_USER_AGENT`; `OPENAI_API_KEY` is optional. The application keeps successful fallback data when an upstream source is unavailable.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
```

The current suite includes:

- **134 deterministic tests** covering ingestion, immutable source hashing, parser replay diffs, normalization, extraction, SEC Company Facts, metric reconciliation and anomaly policy, evidence policy, claim synthesis, numeric fidelity, content-bound review approval, citation verification, production regression contracts, report publishing, quality scoring, company intelligence, events, replay, durable queue contracts, route contracts, rate-limit isolation, and bundle budgets.
- **32 curated research-quality cases plus versioned production cases** covering four companies, topic retrieval, pairwise comparisons, source policy, synthesis, refusal behavior, and analyst-reported failures.
- **11 metric-quality cases** covering golden extraction fixtures, value and unit normalization, scope and period dimensions, anomaly suppression, and live canonical-fact contracts.
- **8 immutable real-document extraction cases** spanning all four Neoclouds, including production false-positive guards and issuer-specific fiscal calendars.
- **20 Chromium journeys** covering login, explicit routes and browser history, real 404 handling, the curated demo, responsive layouts, all four Neoclouds, immutable source download, parser replay and analyst promotion, evidence review, commitments, two-user memo approval, team roles, public report publishing and export, assistant persistence, failure-to-regression promotion, durable job retries, benchmarks, lineage, workspace isolation, and audit history.

CI runs three quality gates. Research answers require at least 85 overall, at least an 85% case pass rate, and 100% citation precision and groundedness. Metrics require at least 90 overall with 100% anomaly safety and live-contract health. Source extraction requires every archived fixture to pass with 100% false-positive and fiscal-period safety.

To run the browser suite against a dedicated local database:

```bash
docker compose exec -T postgres createdb -U ai_infra ai_infra_e2e
E2E_DATABASE_URL="postgresql://ai_infra:ai_infra@localhost:5432/ai_infra_e2e" E2E_REDIS_URL="redis://localhost:6379/1" pnpm test:e2e
```

The E2E fixture refuses to truncate a database whose name does not end in `_e2e` or `_test`.

## Project Structure

```text
app/                    React workspaces and API routes
lib/auth/               Sessions, roles, workspaces, and audit events
lib/artifacts/          Raw source storage, checksums, versions, replay, and promotion
lib/extraction-quality/ Real-document contracts, replay scoring, run history, and parser releases
lib/sec/                SEC client, normalization, extraction, and persistence
lib/ir/                 IR discovery, extraction, and queue processing
lib/research/           Evidence retrieval, memo, assistant, and quality services
lib/company-intelligence/
                        Periods, metrics, commitments, comparisons, and change briefs
lib/events/             Event normalization and discovery policy
lib/replay/             Point-in-time reconstruction and leakage checks
lib/lineage/            Claim-to-evidence graph projection
lib/operations/         Durable queues, workers, tracing, coverage, and briefings
scripts/                Migrations, ingestion, backfills, benchmarks, and demo seed
tests/                  Deterministic and Playwright coverage
docs/architecture/      Reviewer map and architecture decision records
```

## Current Scope

- Live company coverage is limited to the Neocloud theme.
- There is no live market-price feed or price prediction.
- SEC and IR evidence is real; generated analysis is optional and always constrained by saved evidence.
- GDELT can be rate-limited or unavailable, so it remains a non-blocking discovery source.
- Other infrastructure themes remain visible as planned coverage until their source and evidence policies are implemented.

These constraints are deliberate. The project optimizes for defensible research provenance and production-style engineering rather than breadth that cannot be verified.
