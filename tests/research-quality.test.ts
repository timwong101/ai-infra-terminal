import assert from "node:assert/strict";
import test from "node:test";
import { RESEARCH_QUALITY_BENCHMARKS, researchQualityGate, scoreResearchQualityCase } from "@/lib/research/research-quality";
import type { ResearchEvidenceItem, ResearchQualityRun } from "@/lib/research/types";

function evidence(id: string, companyId: string, topic: string): ResearchEvidenceItem {
  return {
    id, companyId, companyName: companyId, ticker: companyId, sourceKind: "ir", sourceDocumentId: `document:${id}`, sourcePassageId: `passage:${id}`,
    sourceType: "Investor update", documentTitle: "Infrastructure update", documentDate: "2026-03-31", sectionTitle: "Operating update", topic,
    excerpt: "The company disclosed specific AI infrastructure capacity.", sourceUrl: `https://example.com/${id}`, pageNumber: null, sourceQuality: 90,
    contentHash: id, evidenceQualityScore: 88, materialityScore: 90, specificityScore: 86, relevanceScore: 92, boilerplateRisk: 5,
    qualityReasons: [], duplicateGroupId: null, duplicateCount: 1, suggestedClaimId: null, suggestedClaimTitle: null, suggestedImpact: null,
    suggestionConfidence: 0, suggestionRationale: null, suggestionStatus: "pending", qualityScoredAt: null, reviewStatus: "accepted", reviewNote: null, reviewedAt: null,
  };
}

test("quality suite contains 32 versioned Neocloud benchmark cases", () => {
  assert.equal(RESEARCH_QUALITY_BENCHMARKS.length, 32);
  assert.equal(new Set(RESEARCH_QUALITY_BENCHMARKS.map((item) => item.id)).size, 32);
  assert.equal(RESEARCH_QUALITY_BENCHMARKS.filter((item) => item.category === "insufficiency").length, 5);
});

test("quality scoring passes complete same-company grounded evidence", () => {
  const benchmark = RESEARCH_QUALITY_BENCHMARKS.find((item) => item.id === "coreweave:capacity")!;
  const item = evidence("evidence:capacity", "coreweave", "Power & capacity");
  const result = scoreResearchQualityCase({
    benchmark,
    evidence: [item],
    claims: [{ companyId: "coreweave", text: "Capacity was disclosed.", citationIds: [item.id], confidenceScore: 90 }],
    rawClaimCount: 1,
    rejectedClaims: 0,
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.scores, { retrievalCoverage: 100, citationPrecision: 100, groundedness: 100, companyAccuracy: 100, answerCompleteness: 100, overall: 100 });
});

test("quality scoring exposes retrieval and citation regressions", () => {
  const benchmark = RESEARCH_QUALITY_BENCHMARKS.find((item) => item.id === "nebius:demand")!;
  const result = scoreResearchQualityCase({ benchmark, evidence: [], claims: [], rawClaimCount: 1, rejectedClaims: 1 });
  assert.equal(result.status, "failed");
  assert.equal(result.scores.retrievalCoverage, 0);
  assert.equal(result.scores.citationPrecision, 0);
  assert.ok(result.failureReasons.some((reason) => reason.includes("rejected")));
});

test("insufficiency cases reward refusing unsupported questions", () => {
  const benchmark = RESEARCH_QUALITY_BENCHMARKS.find((item) => item.id === "iren:future-refusal")!;
  const result = scoreResearchQualityCase({ benchmark, evidence: [], claims: [], rawClaimCount: 0, rejectedClaims: 0 });
  assert.equal(result.status, "passed");
  assert.equal(result.scores.overall, 100);
});

test("quality gate protects overall, pass-rate, citation, and groundedness thresholds", () => {
  const run = {
    overallScore: 84, passRate: 90, metrics: { retrievalCoverage: 90, citationPrecision: 99, groundedness: 100, companyAccuracy: 90, answerCompleteness: 90 },
  } as ResearchQualityRun;
  const gate = researchQualityGate(run);
  assert.equal(gate.passed, false);
  assert.equal(gate.reasons.length, 2);
});
