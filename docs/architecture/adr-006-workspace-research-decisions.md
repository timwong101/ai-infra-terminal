# ADR-006: Global Source Facts and Workspace Research Decisions

## Status

Accepted

## Context

SEC filings, official IR documents, extracted passages, and reported metric observations describe a shared public source corpus. Analyst acceptance, canonical metric selection, custom thesis edits, and memo validity are judgments made inside a workspace. Storing both categories on the same global rows allowed one workspace to change another workspace's research state.

## Decision

Source artifacts and deterministic extraction outputs remain global and immutable. Workspace-owned overlay tables store evidence reviews, analyst-approved claim links, claim-impact alerts, metric reviews, canonical metric selections, thesis state, and research briefings. Retrieval and briefing generation join through the active workspace decision, and a changed decision can stale only memos or briefings in that workspace.

Legacy global review columns remain during the migration window. Existing decisions are copied into each current workspace once, and new writes target only workspace overlays.

## Consequences

- The source corpus is stored once without weakening tenant isolation.
- Two workspaces can reach different, auditable conclusions from the same source passage.
- Claim scores and claim-impact alerts cannot leak an analyst decision into another workspace.
- Every service that consumes approved evidence or canonical metrics must receive a workspace ID.
- Cross-workspace negative tests are part of the analyst journey.
