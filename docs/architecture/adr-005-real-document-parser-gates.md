# ADR-005: Real-Document Parser Release Gates

## Status

Accepted

## Context

Synthetic extraction sentences make individual regex behavior easy to test, but they do not exercise document parsing, section classification, issuer fiscal calendars, table noise, or immutable artifact retrieval together. A parser can pass unit fixtures while producing empty sections, false financial metrics, or the wrong reporting period on a production filing.

## Decision

Parser candidates are evaluated against versioned contracts tied to immutable SEC and investor-relations artifacts. Each case names the source document and asserts a minimum structure, required extraction categories, allowed and expected metrics, forbidden false positives, optional commitments, and an optional fiscal period.

A run records the input SHA-256 hash, extraction-run identity, parser version, replay diff, exact expected and actual payloads, per-dimension scores, and failure reasons. Promotion requires all cases to pass, at least 90 overall, at least 90% critical metric recall, and 100% false-positive and fiscal-period safety. Promotion is workspace-scoped and audited; it does not itself rewrite canonical evidence.

The local portfolio corpus contains eight replayable real documents across CoreWeave, Nebius, Applied Digital, and IREN. Catalog-only IR captures are excluded because saved metadata is not equivalent to source content. CI runs the same gate against a compact archived fixture so builds remain deterministic and independent of upstream availability.

## Consequences

- Parser quality is demonstrated against complete source documents rather than only hand-written sentences.
- Production failures such as issuer-specific fiscal periods and table-value false positives become durable regression contracts.
- A candidate can be inspected and blocked before any canonical evidence changes.
- Benchmark expectations require deliberate versioning when source coverage or taxonomy changes.
- Real-source local runs require PostgreSQL and the configured artifact object store; deterministic CI uses an isolated fixture.
