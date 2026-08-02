# Data Ownership And Lifecycle

The schema is organized around research lifecycle boundaries rather than one table per screen. PostgreSQL is shared by the web process and independent workers, so role, review, and run states are enforced in both application code and database constraints.

## Record Classes

| Class | Examples | Mutation policy | Retention |
| --- | --- | --- | --- |
| Source catalog | `filings`, `ir_documents`, `live_events` | Idempotent upsert by upstream identity | Retained while referenced |
| Immutable provenance | `source_artifacts`, `source_document_versions`, `source_extraction_runs`, audit events | Append-only except integrity and promotion state | Permanent for portfolio scope |
| Global derived research | `research_evidence`, `research_claims`, company metrics and comparisons | Deterministically rebuilt from source records | Replaceable projection |
| Workspace decisions | evidence reviews, claim states, canonical metric selections, alert states | Mutable only through authorized review commands | Workspace lifetime |
| Frozen outputs | memo generations, published reports, quality results, replay runs, briefings | Append-only snapshots | Permanent unless workspace deleted |
| Operational state | cycle runs, stage events, worker heartbeats, rate limits | Queue and runtime managed | Bounded or periodically expired |

## Intentional Global And Workspace Pairs

`claim_evidence` and `workspace_claim_evidence` are not competing sources of truth. The global table records a deterministic machine suggestion. The workspace table records whether a particular analyst team accepted that relationship and preserves its own rationale.

The same rule applies to global metrics versus workspace canonical metrics and global evidence quality versus workspace evidence reviews. Upstream facts can be shared; investment judgments cannot leak across workspaces.

## JSONB Policy

JSONB is reserved for immutable generation snapshots, external-source payloads, stage metrics, and configuration captured for replay. Queryable identity, status, ownership, time, and relationship fields remain relational columns. New mutable business state must not be introduced only inside JSONB.

Snapshot readers must tolerate additive fields. Breaking changes require a new parser, prompt, suite, or snapshot version rather than rewriting historical output.

## Deliberate Simplifications

- The four-company portfolio uses one PostgreSQL database and one schema; there are no per-company databases or microservices.
- Redis owns dispatch and retry state only. Research and audit history remain in PostgreSQL.
- Company-intelligence tables are replaceable projections and rebuild under one advisory lock instead of introducing a streaming platform.
- Workspace-scoped decision tables remain separate from global extracted facts because collapsing them would break tenant isolation and point-in-time replay.

## Removal Test

A new table must satisfy at least one of these conditions: it owns an independently authorized decision, preserves an immutable historical artifact, or supports a query that cannot be represented safely by an existing owner. Otherwise, extend the existing owner or use a versioned snapshot field.
