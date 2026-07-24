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
- Discovery events cannot silently become trusted research.
- Historical replay checks that future information did not leak across the selected cutoff.
- Analyst decisions and generated artifacts remain attributable in an audit trail.

The initial live coverage focuses on four Neocloud companies: **CoreWeave, Nebius, Applied Digital, and IREN**. The infrastructure map keeps the broader taxonomy visible while clearly distinguishing live research from planned coverage.

## Two-Minute Demo

1. Start the app and choose **Open portfolio demo**.
2. Open **Research → Evidence** to inspect real SEC and IR passages, quality signals, review state, and original sources.
3. Open **Analysis → Ask** to review a saved four-company answer with claim checks and inline citations.
4. Open **Analysis → Memos** for the cited CoreWeave vs. Nebius comparison and its frozen evidence packet.
5. Open **Analysis → Replay** to compare what the evidence supported on February 1, 2026 with what is accepted today.
6. Open **Research → Lineage** or **System → Audit** to trace generated claims back to sources and analyst actions.

The demo seeder is idempotent. It repairs missing portfolio artifacts, removes accidental empty research sessions, and reuses completed artifacts instead of creating duplicates:

```bash
pnpm demo:seed
```

It does not insert synthetic research evidence. The seeded memo, answer, benchmark, and replay are produced by the same application services used in normal workflows.

## What It Demonstrates

| Product capability | Engineering signal |
| --- | --- |
| SEC and official IR ingestion | Source-specific normalization, retry policy, caching, and idempotent persistence |
| Evidence review | Human-in-the-loop workflow with durable decisions and provenance |
| Research Assistant | Grounded retrieval, structured generation, streaming UI, and citation verification |
| Comparison memos | Saved generation metadata, frozen evidence packets, and stale-artifact detection |
| Research Quality | Versioned evaluation suite with deterministic CI gates and model diagnostics |
| Point-in-time replay | Temporal data modeling and explicit leakage checks |
| Claim-to-evidence lineage | Relational provenance projected into an interactive graph |
| Workspaces and roles | GitHub OAuth, database sessions, tenant isolation, and RBAC |
| Research operations | Scheduled pipelines, trace IDs, stage status, briefings, and failure visibility |
| Responsive terminal UI | Dense information design across desktop and mobile workflows |

## Architecture

```mermaid
flowchart LR
    SEC["SEC EDGAR"] --> INGEST["Ingest, normalize, extract"]
    IR["Official investor relations"] --> INGEST
    GDELT["GDELT discovery"] --> EVENTS["Discovery event pipeline"]

    INGEST --> DOCS[("Postgres documents and passages")]
    DOCS --> QUALITY["Evidence quality policy"]
    QUALITY --> REVIEW["Analyst review"]
    REVIEW --> SEARCH["Full-text and optional vector retrieval"]

    SEARCH --> ASK["Research Assistant"]
    SEARCH --> MEMO["Comparison memos"]
    SEARCH --> BENCH["Quality benchmarks"]
    SEARCH --> REPLAY["Point-in-time replay"]

    REVIEW --> THESES["Claims, alerts, thesis history"]
    EVENTS -. "proposal only" .-> THESES

    ASK --> LINEAGE["Lineage and audit"]
    MEMO --> LINEAGE
    REPLAY --> LINEAGE
    THESES --> LINEAGE
```

The application is a TypeScript monolith with clear service boundaries. React workspaces call App Router API handlers; domain services own retrieval, verification, replay, ingestion, and persistence; PostgreSQL stores both research data and operational history.

### Claim-To-Evidence Model

```mermaid
erDiagram
    COMPANY ||--o{ SOURCE_DOCUMENT : publishes
    SOURCE_DOCUMENT ||--o{ EVIDENCE : contains
    EVIDENCE }o--o{ CLAIM : supports
    CLAIM }o--o{ MEMO : appears_in
    WORKSPACE ||--o{ MEMO : owns
    USER ||--o{ EVIDENCE : reviews
    USER ||--o{ AUDIT_EVENT : performs
    WORKSPACE ||--o{ RESEARCH_SESSION : owns
    RESEARCH_SESSION ||--o{ RESEARCH_MESSAGE : contains
```

An evidence record retains the source document, exact excerpt, section, document date, original URL, optional PDF page, quality scores, review decision, reviewer, and timestamps. Generated outputs store evidence snapshots rather than relying on a future retrieval to reconstruct what the model saw.

## Grounding And Hallucination Controls

The same safety policy applies whether generation uses an OpenAI model or the deterministic local engine.

1. **Retrieval gate:** Only accepted evidence above the quality threshold is eligible. Company, topic, source, and date filters are applied during retrieval.

2. **Company-scoped citations:** A factual claim about CoreWeave cannot cite a Nebius passage. Unknown, missing, and cross-company citation IDs are rejected.

3. **Unsupported-claim removal:** Verification runs before an answer or memo is saved. Open questions can remain uncited; factual claims cannot.

4. **Frozen evidence packets:** Memos, answers, quality cases, and replay runs persist the exact passages used to produce the output.

5. **Staleness propagation:** Rejecting or changing cited evidence marks affected research stale instead of silently leaving it current.

6. **Source-policy separation:** GDELT articles are discovery signals. They cannot enter memo retrieval or change thesis scores until official evidence is extracted and accepted.

7. **Temporal integrity:** Replay supports both publication-time reconstruction and the stricter system-known policy, then reports leakage diagnostics.

## Core Workflows

### Evidence To Thesis

SEC filings and IR documents are normalized into citation-ready passages. Deterministic scoring measures materiality, specificity, AI-infrastructure relevance, and boilerplate risk. Analysts can accept, reject, or reassign proposed claim links; those decisions rebuild thesis state and may create evidence-backed alerts.

### Evidence To Answer

The Research Assistant retrieves across one or more companies and returns a cited answer, confidence score, evidence quality, source diversity, open questions, and claim-check status. Sessions have durable URLs and retain model, token, filter, and evidence metadata.

### Evidence To Memo

The comparison workflow analyzes two companies with accepted evidence only. It supports Postgres full-text search plus optional pgvector similarity. Each saved memo includes six balanced sections, inline citations, retrieval mode, generation engine, verification result, and a frozen source packet.

### Evidence Through Time

Point-in-time replay reconstructs the eligible packet at an earlier date and compares it with the current packet. This makes thesis drift inspectable without pretending that an omitted filing passage was necessarily retracted.

### Pipeline To Analyst Inbox

The scheduled research cycle runs SEC, IR, live-event, evidence, intelligence, embedding, thesis, and briefing stages. Each run records stage timing and failures under a trace ID. The Activity workspace converts the result into a research briefing rather than forcing the analyst to inspect raw ingestion logs.

## Technology

| Layer | Choice |
| --- | --- |
| Frontend | React 19, TypeScript, Tailwind CSS 4, Lucide |
| Application | Next.js-compatible App Router via vinext |
| Database | PostgreSQL 17, pgvector, Drizzle ORM |
| AI | Vercel AI SDK with optional OpenAI generation |
| Parsing | Cheerio for HTML, unpdf for page-aware PDF extraction |
| Visualization | Cytoscape for interactive lineage |
| Authentication | GitHub OAuth, database sessions, workspace RBAC |
| Testing | Node test runner, Playwright, deterministic research quality gate |
| Automation | GitHub Actions CI and six-hour ingestion workflow |

The deterministic engine keeps the complete product usable without an API key. An OpenAI key enables structured model generation, but all model output still passes through the same citation verifier.

## Engineering Decisions

### Evidence quality is not analyst approval

Scoring is a triage tool. It can prioritize specific, material passages and suppress boilerplate, but it does not replace analyst judgment. Review state is modeled separately and remains visible.

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
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The root URL resolves to `/login`; the portfolio demo requires no OAuth configuration.

SEC asks automated clients to identify themselves. Replace the example value in `.env.local` with a real application name and contact email:

```env
SEC_USER_AGENT="AI Infra Terminal your-email@example.com"
DATABASE_URL="postgresql://ai_infra:ai_infra@localhost:5432/ai_infra"
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
| `pnpm research:intelligence` | Rebuild periods, earnings packages, metrics, and change briefs |
| `pnpm research:events` | Refresh official and GDELT event discovery |
| `pnpm research:briefing` | Build a briefing from the current research window |
| `pnpm research:cycle` | Run the complete research pipeline |
| `pnpm research:quality -- --gate` | Run the versioned benchmark and enforce CI thresholds |

SEC refreshes preserve recurring quarterly and annual coverage before newer event filings. IR ingestion only follows configured official domains, requires publication dates, rejects SEC mirrors, deduplicates repeated cards, and queues unseen documents for bounded retries.

The six-hour GitHub Actions ingestion workflow requires repository secrets for `DATABASE_URL` and `SEC_USER_AGENT`; `OPENAI_API_KEY` is optional. The application keeps successful fallback data when an upstream source is unavailable.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
```

The current suite includes:

- **79 deterministic tests** covering ingestion, normalization, extraction, evidence policy, citation verification, quality scoring, company intelligence, events, and replay.
- **32 research-quality cases** covering four companies, topic retrieval, pairwise comparisons, source policy, synthesis, and refusal behavior.
- **11 Chromium journeys** covering login, the curated demo, responsive layouts, all four Neoclouds, evidence review, memos, assistant persistence, benchmarks, replay, lineage, RBAC, workspace isolation, and audit history.

The CI quality gate requires at least 85 overall, at least an 85% case pass rate, and 100% citation precision and groundedness.

To run the browser suite against a dedicated local database:

```bash
docker compose exec -T postgres createdb -U ai_infra ai_infra_e2e
E2E_DATABASE_URL="postgresql://ai_infra:ai_infra@localhost:5432/ai_infra_e2e" pnpm test:e2e
```

The E2E fixture refuses to truncate a database whose name does not end in `_e2e` or `_test`.

## Project Structure

```text
app/                    React workspaces and API routes
lib/auth/               Sessions, roles, workspaces, and audit events
lib/sec/                SEC client, normalization, extraction, and persistence
lib/ir/                 IR discovery, extraction, and queue processing
lib/research/           Evidence retrieval, memo, assistant, and quality services
lib/company-intelligence/
                        Period resolution, metrics, comparisons, and change briefs
lib/events/             Event normalization and discovery policy
lib/replay/             Point-in-time reconstruction and leakage checks
lib/lineage/            Claim-to-evidence graph projection
lib/operations/         Research cycles, coverage, and briefings
scripts/                Migrations, ingestion, backfills, benchmarks, and demo seed
tests/                  Deterministic and Playwright coverage
```

## Current Scope

- Live company coverage is limited to the Neocloud theme.
- There is no live market-price feed or price prediction.
- SEC and IR evidence is real; generated analysis is optional and always constrained by saved evidence.
- GDELT can be rate-limited or unavailable, so it remains a non-blocking discovery source.
- Other infrastructure themes remain visible as planned coverage until their source and evidence policies are implemented.

These constraints are deliberate. The project optimizes for defensible research provenance and production-style engineering rather than breadth that cannot be verified.
