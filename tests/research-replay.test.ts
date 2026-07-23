import assert from "node:assert/strict";
import test from "node:test";
import { buildReplayClaims, replayLeakageViolations } from "@/lib/replay/service";
import type { ResearchEvidenceItem } from "@/lib/research/types";

function evidence(overrides: Partial<ResearchEvidenceItem> = {}): ResearchEvidenceItem {
  return {
    id: "evidence:1",
    companyId: "coreweave",
    companyName: "CoreWeave",
    ticker: "CRWV",
    sourceKind: "ir",
    sourceDocumentId: "document:1",
    sourcePassageId: "passage:1",
    sourceType: "Investor update",
    documentTitle: "Capacity update",
    documentDate: "2026-01-10",
    sectionTitle: "Capacity",
    topic: "Power & capacity",
    excerpt: "CoreWeave reported 200 MW of active capacity. Additional construction remains underway.",
    sourceUrl: "https://example.com/source",
    pageNumber: null,
    sourceQuality: 90,
    contentHash: "hash",
    evidenceQualityScore: 88,
    materialityScore: 90,
    specificityScore: 86,
    relevanceScore: 92,
    boilerplateRisk: 4,
    qualityReasons: [],
    duplicateGroupId: null,
    duplicateCount: 1,
    suggestedClaimId: null,
    suggestedClaimTitle: null,
    suggestedImpact: null,
    suggestionConfidence: 0,
    suggestionRationale: null,
    suggestionStatus: "pending",
    qualityScoredAt: null,
    reviewStatus: "accepted",
    reviewNote: null,
    reviewedAt: "2026-01-12T12:00:00.000Z",
    ...overrides,
  };
}

test("strict replay detects publication and review leakage after the boundary", () => {
  assert.equal(replayLeakageViolations([evidence()], "2026-01-11", true), 1);
  assert.equal(replayLeakageViolations([evidence()], "2026-01-12", true), 0);
  assert.equal(replayLeakageViolations([evidence({ documentDate: "2026-02-01" })], "2026-01-31", false), 1);
});

test("replay claims stay company-scoped, topic-diverse, and cited", () => {
  const items = [
    evidence(),
    evidence({ id: "evidence:2", topic: "Financing & liquidity", excerpt: "CoreWeave reported $800 million of available liquidity." }),
    evidence({ id: "evidence:3", topic: "Power & capacity", excerpt: "A duplicate capacity observation." }),
  ];
  const claims = buildReplayClaims(items, ["coreweave"]);
  assert.equal(claims.length, 2);
  assert.deepEqual(claims.map((item) => item.citationIds), [["evidence:1"], ["evidence:2"]]);
  assert.ok(claims.every((item) => item.companyId === "coreweave"));
});

