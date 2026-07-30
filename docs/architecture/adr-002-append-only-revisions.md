# ADR-002: Append-Only Temporal Revisions

## Status

Accepted

## Context

Overwriting a target destroys the evidence of what management originally said. Sorting only by ingestion time also makes late-arriving historical documents appear current.

## Decision

The base commitment is durable and revisions are append-only. Each revision stores:

- `valid_from`: the source date when the statement applied in the real world.
- `recorded_at`: when the terminal learned about it.
- `previous_revision_id`: the semantic predecessor used for change classification.
- `sequence`: immutable system insertion order.

The active statement is selected by valid time, then sequence. A late-arriving older source is preserved without replacing a newer real-world statement.

## Consequences

- The terminal can explain both "what was known then" and "what we learned later."
- Replay and audit workflows can reconstruct history without mutation logs.
- Corrections require a new revision or review decision; they do not rewrite source history.
