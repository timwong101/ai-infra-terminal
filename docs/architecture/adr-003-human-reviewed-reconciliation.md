# ADR-003: Human-Reviewed Reconciliation

## Status

Accepted

## Context

An extracted future target is not automatically a trusted commitment, and a numerically similar later metric may use a different scope, unit, or reporting period.

## Decision

The system separates three decisions:

1. Evidence acceptance determines whether a source passage is eligible for extraction.
2. Commitment review confirms identity, value, scope, and target period.
3. Outcome reconciliation links an accepted commitment to an analyst-approved canonical metric and records the analyst's outcome classification.

The service calculates variance only for matching units. It suggests an outcome from deterministic thresholds, but the analyst records `achieved`, `partial`, `missed`, or `not-comparable`.

## Consequences

- Model or regex confidence cannot silently become an investment fact.
- Every outcome names the reviewer, canonical metric, rationale, and recording time.
- Ambiguous scopes remain visible instead of being forced into a false comparison.
