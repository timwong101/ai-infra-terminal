import assert from "node:assert/strict";
import test from "node:test";
import { chunkResearchAssistantMarkdown, scoreResearchAssistantEvidence, verifyResearchAssistantOutput } from "../lib/research/research-assistant";
import type { ResearchEvidenceItem } from "../lib/research/types";

function evidence(id: string, companyId: string): ResearchEvidenceItem {
  return {
    id, companyId, companyName: companyId, ticker: companyId, sourceKind: "ir", sourceDocumentId: `document:${id}`,
    sourcePassageId: `passage:${id}`, sourceType: "Investor update", documentTitle: "Infrastructure update",
    documentDate: "2026-03-31", sectionTitle: "Capacity", topic: "Power & capacity",
    excerpt: "The company reported active capacity supported by contracted customer demand.", sourceUrl: `https://example.com/${id}`,
    pageNumber: null, sourceQuality: 90, contentHash: id, evidenceQualityScore: 88, materialityScore: 90,
    specificityScore: 86, relevanceScore: 92, boilerplateRisk: 5, qualityReasons: [], duplicateGroupId: null,
    duplicateCount: 1, suggestedClaimId: null, suggestedClaimTitle: null, suggestedImpact: null,
    suggestionConfidence: 0, suggestionRationale: null, suggestionStatus: "pending", qualityScoredAt: null,
    reviewStatus: "accepted", reviewNote: null, reviewedAt: null,
  };
}

const packet = [evidence("coreweave:1", "coreweave"), evidence("nebius:1", "nebius")];

test("research assistant accepts claims with valid same-company citations", () => {
  const result = verifyResearchAssistantOutput({ claims: [{ companyId: "coreweave", text: "Supported capacity claim", citationIds: ["coreweave:1"], confidenceScore: 84 }], openQuestions: [] }, packet, ["coreweave", "nebius"]);
  assert.equal(result.verification.passed, true);
  assert.equal(result.claims.length, 1);
});

test("research assistant rejects unsupported claims instead of presenting them", () => {
  const result = verifyResearchAssistantOutput({ claims: [{ companyId: "coreweave", text: "Unsupported claim", citationIds: ["missing"], confidenceScore: 90 }], openQuestions: [] }, packet, ["coreweave"]);
  assert.equal(result.verification.passed, false);
  assert.equal(result.verification.rejectedClaims, 1);
  assert.deepEqual(result.claims, []);
});

test("research assistant rejects citations attributed to the wrong company", () => {
  const result = verifyResearchAssistantOutput({ claims: [{ companyId: "coreweave", text: "Misattributed claim", citationIds: ["nebius:1"], confidenceScore: 90 }], openQuestions: [] }, packet, ["coreweave", "nebius"]);
  assert.equal(result.verification.rejectedClaims, 1);
  assert.deepEqual(result.claims, []);
});

test("research assistant evidence scoring returns zero confidence for an empty packet", () => {
  assert.deepEqual(scoreResearchAssistantEvidence([], ["coreweave"]), { confidence: 0, quality: 0, diversity: 0 });
});

test("research assistant streaming preserves long citation URLs byte for byte", () => {
  const markdown = `Evidence [[1]](https://www.sec.gov/Archives/edgar/data/${"1".repeat(180)}/filing.htm)`;
  assert.equal(chunkResearchAssistantMarkdown(markdown).join(""), markdown);
});
