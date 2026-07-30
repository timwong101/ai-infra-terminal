# ADR-004: Immutable Source Artifacts and Versioned Extraction

## Status

Accepted

## Context

SEC filing HTML and investor-relations PDFs can change, disappear, or become temporarily unavailable. Persisting only extracted passages is insufficient to prove which bytes produced a research claim, and fetching a URL again is not a deterministic replay.

## Decision

Every extractable SEC or IR document is archived before parsing. Raw content is addressed by its SHA-256 hash in S3-compatible object storage. PostgreSQL separately records the immutable artifact, each document fetch that references it, and each parser run against that version.

Parser reprocessing creates an isolated preview containing its complete output snapshot and a passage-level diff. It cannot replace canonical evidence until an analyst promotes it. Promotion preserves unchanged review decisions, resets changed accepted passages to unreviewed, and marks dependent claims and memos stale.

The storage interface also has a filesystem implementation for deterministic CI. Production and the Docker development environment use the same S3 API through MinIO or a managed object store.

Historical IR backfills distinguish raw captures from metadata recovery. If an official legacy URL is blocked or no longer matches the current source policy, the system archives a typed catalog snapshot and creates an isolated parser preview. It does not describe that object as the missing HTML or PDF, and it does not replace the previously extracted canonical evidence.

## Consequences

- Source provenance remains reproducible if an upstream URL changes or disappears.
- Identical content is stored once even when discovered through multiple documents.
- Parser upgrades and backfills are auditable and reversible.
- Object storage and PostgreSQL cannot share one transaction, so orphaned content-addressed objects are harmless and can be garbage-collected later.
- Existing documents require a backfill; parser differences discovered during that backfill remain previews rather than silently rewriting evidence.
- A catalog snapshot proves which saved metadata was available during recovery, but it is not equivalent to archived source bytes and remains visibly labeled as such.
