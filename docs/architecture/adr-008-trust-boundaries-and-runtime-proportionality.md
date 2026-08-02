# ADR-008: Trust boundaries and proportional runtime

## Status

Accepted.

## Context

Evidence scoring, analyst approval, generated-claim verification, and release evaluation are different decisions. Treating a high heuristic score as analyst approval made the human-review claim inaccurate. Checking only that a citation belonged to the same company also allowed an unrelated sentence to appear grounded.

The scheduled six-hour ingestion job previously started Redis-backed workers inside the same short-lived GitHub Actions process. That reproduced the interactive queue topology without gaining restart durability after the runner exited.

## Decision

- Quality scoring produces machine-prioritized candidates only. It never creates an accepted workspace review.
- Only an authenticated analyst mutation creates an accepted review. Reproducible portfolio seed decisions are visibly labeled as seeded demo fixtures.
- Generated factual claims must pass citation ownership, lexical support, numeric fidelity, and readability checks.
- Generation and evaluation policies are versioned. Old memo and assistant output is visibly stale; publication requires the current research-quality release gate.
- Interactive and manually queued cycles continue through BullMQ for retries, cancellation, and restart durability.
- The scheduled GitHub Actions cycle runs the same stage graph directly and records the same run and stage telemetry without a disposable Redis service.

## Consequences

The UI can no longer claim human approval based on a heuristic. New workspaces begin with an analyst queue and require an explicit review action before retrieval. Old outputs can become unavailable for publication after a verifier change until they are regenerated and the current benchmark passes. CI treats missing source-policy coverage as a release failure; memo publication still enforces score, citation, groundedness, insufficiency, and production-regression checks without blocking a reviewed memo for an unrelated source cell. Scheduled operation is simpler, while durable queue behavior remains available where it changes failure recovery.
