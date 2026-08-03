import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { claimEvidenceSupport, verifyNumericFidelity } from "@/lib/research/claim-synthesis";
import type { ResearchEvidenceItem } from "@/lib/research/types";

type Fixture = { id: string; evidence: string; claim: string; expected: boolean };

const fixtureUrl = new URL("./fixtures/research-quality/adversarial-grounding.json", import.meta.url);

function evidence(excerpt: string): ResearchEvidenceItem {
  return {
    id: "fixture:evidence",
    companyId: "coreweave",
    companyName: "Fixture Company",
    ticker: "TEST",
    sourceKind: "sec",
    sourceType: "SEC 8-K",
    sourceDocumentId: "fixture:document",
    sourcePassageId: "fixture:passage",
    sourceUrl: "https://example.com/fixture",
    documentDate: "2026-01-01",
    documentTitle: "Adversarial grounding fixture",
    sectionTitle: "Fixture section",
    excerpt,
    topic: "Power & capacity",
    sourceQuality: 90,
    evidenceQualityScore: 90,
    materialityScore: 90,
    specificityScore: 90,
    relevanceScore: 90,
    boilerplateRisk: 0,
    qualityReasons: [],
    duplicateGroupId: null,
    duplicateCount: 0,
    suggestedClaimId: null,
    suggestedClaimTitle: null,
    suggestedImpact: null,
    suggestionConfidence: 0,
    suggestionRationale: null,
    suggestionStatus: "pending",
    qualityScoredAt: null,
    reviewStatus: "accepted",
    reviewNote: null,
    reviewedAt: null,
    reviewedBy: null,
    contentHash: "fixture",
    pageNumber: null,
  };
}

test("grounding policy rejects the hand-authored adversarial corpus", async () => {
  const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8")) as Fixture[];
  for (const fixture of fixtures) {
    const cited = [evidence(fixture.evidence)];
    const accepted = claimEvidenceSupport(fixture.claim, cited).passed
      && verifyNumericFidelity(fixture.claim, cited).passed;
    assert.equal(accepted, fixture.expected, fixture.id);
  }
});
