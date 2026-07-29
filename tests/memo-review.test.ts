import assert from "node:assert/strict";
import test from "node:test";
import { comparisonMemoContentHash } from "@/lib/reviews/service";
import type { ComparisonMemo } from "@/lib/research/types";

function memo(): ComparisonMemo {
  return {
    id: "memo:review-test",
    title: "CoreWeave vs. Nebius",
    question: "Compare infrastructure exposure.",
    companyA: { id: "coreweave", name: "CoreWeave", ticker: "CRWV" },
    companyB: { id: "nebius", name: "Nebius", ticker: "NBIS" },
    topic: "All topics",
    confidenceScore: 85,
    evidenceQualityScore: 88,
    sourceDiversityScore: 90,
    status: "draft",
    isStale: false,
    staleReason: null,
    staleAt: null,
    sections: [{ key: "summary", title: "Summary", claims: [{ companyId: "coreweave", text: "Supported claim.", citationIds: ["evidence:1"] }] }],
    citations: [{ id: "evidence:1", excerpt: "Supported claim.", contentHash: "source-hash" } as ComparisonMemo["citations"][number]],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

test("memo review hashes bind approval to research content, not workflow status", async () => {
  const draft = memo();
  const submitted = { ...draft, status: "in_review" as const, updatedAt: "2026-01-02T00:00:00.000Z" };
  assert.equal(await comparisonMemoContentHash(draft), await comparisonMemoContentHash(submitted));
});

test("memo review hashes change when a claim or evidence packet changes", async () => {
  const original = memo();
  const changedClaim = structuredClone(original);
  changedClaim.sections[0].claims[0].text = "Materially changed claim.";
  const changedEvidence = structuredClone(original);
  changedEvidence.citations[0].contentHash = "replacement-source-hash";
  assert.notEqual(await comparisonMemoContentHash(original), await comparisonMemoContentHash(changedClaim));
  assert.notEqual(await comparisonMemoContentHash(original), await comparisonMemoContentHash(changedEvidence));
});
