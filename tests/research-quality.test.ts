import assert from "node:assert/strict";
import test from "node:test";
import { RESEARCH_QUALITY_BENCHMARKS, researchQualityGate, scoreResearchQualityCase } from "@/lib/research/research-quality";
import { researchPublicationQualityGate } from "@/lib/research/research-quality-policy";
import { buildProductionRegressionContract } from "@/lib/research/quality-feedback";
import type { ResearchEvidenceItem, ResearchQualityRun, ResearchQualityTrace } from "@/lib/research/types";

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

test("quality suite contains 32 curated Neocloud benchmark cases", () => {
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
    claims: [{ companyId: "coreweave", text: "The company disclosed specific AI infrastructure capacity.", citationIds: [item.id], confidenceScore: 90 }],
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

test("citation precision and groundedness measure different failure modes", () => {
  const benchmark = RESEARCH_QUALITY_BENCHMARKS.find((item) => item.id === "coreweave:capacity")!;
  const item = evidence("evidence:capacity", "coreweave", "Power & capacity");
  const result = scoreResearchQualityCase({
    benchmark,
    evidence: [item],
    claims: [{ companyId: "coreweave", text: "The company disclosed specific AI infrastructure capacity.", citationIds: ["evidence:missing"], confidenceScore: 90 }],
    rawClaimCount: 1,
    rejectedClaims: 0,
  });
  assert.equal(result.scores.citationPrecision, 0);
  assert.equal(result.scores.groundedness, 0);
  assert.ok(result.failureReasons.some((reason) => reason.includes("did not resolve")));
});

test("production cases can require retrieval of an exact frozen evidence set", () => {
  const item = evidence("evidence:expected", "coreweave", "Power & capacity");
  const benchmark = {
    ...RESEARCH_QUALITY_BENCHMARKS.find((candidate) => candidate.id === "coreweave:capacity")!,
    expectations: {
      topics: [],
      behavior: "answer" as const,
      minimumCitations: 1,
      expectedEvidenceIds: [item.id, "evidence:not-retrieved"],
    },
  };
  const result = scoreResearchQualityCase({
    benchmark,
    evidence: [item],
    claims: [{ companyId: "coreweave", text: "The company disclosed specific AI infrastructure capacity.", citationIds: [item.id], confidenceScore: 90 }],
    rawClaimCount: 1,
    rejectedClaims: 0,
  });
  assert.equal(result.scores.retrievalCoverage, 50);
  assert.equal(result.status, "failed");
});

test("wrong-retrieval promotion turns analyst scope into an executable contract", () => {
  const coreweaveEvidence = evidence("evidence:coreweave", "coreweave", "Power & capacity");
  const irenEvidence = evidence("evidence:iren", "iren", "Power & capacity");
  const trace = {
    sourceType: "research-assistant",
    sourceEntityId: "message:1",
    question: "What supports CoreWeave capacity growth?",
    answerMarkdown: "Answer",
    claims: [],
    filters: { companyIds: ["coreweave", "iren"], topic: "All topics", sourceKinds: [] },
    engine: "deterministic",
    model: "deterministic-v1",
    prompt: "Prompt",
    promptVersion: "research-assistant-v2",
    configSnapshot: {},
    retrievalMode: "full-text",
    evidenceSnapshot: [coreweaveEvidence, irenEvidence],
    metricSnapshot: [],
    verification: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCostMicros: 0,
    latencyMs: 12,
    completedAt: "2026-07-30T00:00:00.000Z",
  } satisfies ResearchQualityTrace;
  const contract = buildProductionRegressionContract("wrong-retrieval", trace, ["coreweave"]);
  assert.deepEqual(contract.filters.companyIds, ["coreweave"]);
  assert.equal(contract.expectations.minimumCitations, 1);
  assert.deepEqual(contract.expectations.expectedEvidenceIds, []);
});

test("unsupported-claim promotion freezes eligible evidence for replay", () => {
  const item = evidence("evidence:coreweave", "coreweave", "Power & capacity");
  const trace = {
    sourceType: "research-assistant",
    sourceEntityId: "message:2",
    question: "What supports CoreWeave capacity growth?",
    answerMarkdown: "Answer",
    claims: [],
    filters: { companyIds: ["coreweave"], topic: "Power & capacity", sourceKinds: ["ir"] },
    engine: "deterministic",
    model: "deterministic-v1",
    prompt: "Prompt",
    promptVersion: "research-assistant-v2",
    configSnapshot: {},
    retrievalMode: "full-text",
    evidenceSnapshot: [item],
    metricSnapshot: [],
    verification: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    estimatedCostMicros: 0,
    latencyMs: 10,
    completedAt: "2026-07-30T00:00:00.000Z",
  } satisfies ResearchQualityTrace;
  const contract = buildProductionRegressionContract("unsupported-claim", trace, ["coreweave"]);
  assert.deepEqual(contract.expectations.expectedEvidenceIds, [item.id]);
  assert.deepEqual(contract.expectations.topics, ["Power & capacity"]);
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

test("quality gate blocks critical source-policy and refusal regressions despite healthy aggregates", () => {
  const run = {
    overallScore: 98,
    passRate: 94,
    metrics: { retrievalCoverage: 96, citationPrecision: 100, groundedness: 100, companyAccuracy: 98, answerCompleteness: 97 },
    results: [{ status: "failed", category: "source-policy", title: "CoreWeave IR source policy" }],
  } as ResearchQualityRun;
  const gate = researchQualityGate(run);
  assert.equal(gate.passed, false);
  assert.match(gate.reasons.at(-1) ?? "", /CoreWeave IR source policy/);
});

test("publication gate allows source-coverage gaps but blocks behavioral regressions", () => {
  const healthy = {
    overallScore: 98,
    passRate: 94,
    metrics: { retrievalCoverage: 96, citationPrecision: 100, groundedness: 100, companyAccuracy: 98, answerCompleteness: 97 },
  };
  const sourcePolicy = researchPublicationQualityGate({
    ...healthy,
    results: [{ status: "failed", category: "source-policy", title: "Missing optional IR coverage" }],
  } as ResearchQualityRun);
  assert.equal(sourcePolicy.passed, true);

  const refusal = researchPublicationQualityGate({
    ...healthy,
    results: [{ status: "failed", category: "insufficiency", title: "Unsupported answer was not refused" }],
  } as ResearchQualityRun);
  assert.equal(refusal.passed, false);
});
