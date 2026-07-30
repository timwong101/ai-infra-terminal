# ADR-001: Stable Commitment Identity

## Status

Accepted

## Context

Management may raise a target, lower it, or move its delivery date. If value or date is part of the record identity, each revision appears to be an unrelated promise and the terminal cannot show a trustworthy history.

## Decision

A commitment is identified by company, normalized metric, scope type, and normalized scope label. Target value and target date belong to revisions, not identity.

Every candidate must originate from an accepted evidence passage and retain that source. Identity is deterministic; analyst acceptance is separate from extraction confidence.

## Consequences

- Raises, reductions, reiterations, and delays remain on one timeline.
- Multiple facility commitments can coexist when their scope labels differ.
- Ambiguous company-level statements may collide and therefore remain proposed until an analyst confirms scope.
