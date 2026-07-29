import assert from "node:assert/strict";
import test from "node:test";
import {
  createDeterministicMemoClaim,
  extractNumericFacts,
  synthesizeMemoSections,
  verifyNumericFidelity,
} from "@/lib/research/claim-synthesis";
import type { ComparisonMemoSection, ResearchEvidenceItem } from "@/lib/research/types";

function evidence(overrides: Partial<ResearchEvidenceItem> = {}): ResearchEvidenceItem {
  return {
    id: "evidence-apld",
    companyId: "applied-digital",
    companyName: "Applied Digital",
    ticker: "APLD",
    sourceKind: "ir",
    sourceDocumentId: "document-apld",
    sourcePassageId: "passage-apld",
    sourceType: "Investor Presentation",
    documentTitle: "Investor Presentation",
    documentDate: "2026-07-15",
    sectionTitle: "AI Factories",
    topic: "Power & capacity",
    excerpt: "Revenue increased 95% to $64.2 million. Applied Digital signed a 15-year lease covering 400 MW of critical IT load.",
    sourceUrl: "https://example.com/apld",
    pageNumber: 6,
    sourceQuality: 90,
    contentHash: "hash",
    evidenceQualityScore: 86,
    materialityScore: 90,
    specificityScore: 90,
    relevanceScore: 88,
    boilerplateRisk: 5,
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
    ...overrides,
  };
}

function sections(claim: ComparisonMemoSection["claims"][number]): ComparisonMemoSection[] {
  return [{ key: "exposure", title: "AI infrastructure exposure", claims: [claim] }];
}

test("normalizes equivalent financial units and duration facts", () => {
  assert.deepEqual(extractNumericFacts("$1.25B under a 15-year contract"), ["$1.25:billion", "15:year"]);
  const result = verifyNumericFidelity("$1.25 billion under a 15 year contract", [
    evidence({ excerpt: "The company disclosed $1.25B under a 15-year contract." }),
  ]);
  assert.equal(result.passed, true);
});

test("keeps concise, source-supported paraphrases and adds claim quality metadata", () => {
  const result = synthesizeMemoSections(sections({
    companyId: "applied-digital",
    text: "Applied Digital disclosed a 15-year lease covering 400 MW of critical IT load.",
    citationIds: ["evidence-apld"],
    representation: "paraphrase",
    whyItMatters: "Shows how contracted power can become usable AI capacity.",
  }), [evidence()], ["applied-digital", "nebius"]);
  const claim = result.sections[0].claims[0];
  assert.equal(claim.synthesisStatus, "verified");
  assert.equal(claim.representation, "paraphrase");
  assert.ok((claim.qualityScore ?? 0) >= 70);
  assert.equal(result.diagnostics.synthesisFallbackClaims, 0);
});

test("replaces a claim with its exact source sentence when a numeric fact drifts", () => {
  const result = synthesizeMemoSections(sections({
    companyId: "applied-digital",
    text: "Applied Digital disclosed a 15-year lease covering 500 MW of critical IT load.",
    citationIds: ["evidence-apld"],
    representation: "paraphrase",
    whyItMatters: "Shows how contracted power can become usable AI capacity.",
  }), [evidence()], ["applied-digital", "nebius"]);
  const claim = result.sections[0].claims[0];
  assert.equal(claim.text, "Applied Digital signed a 15-year lease covering 400 MW of critical IT load.");
  assert.equal(claim.representation, "quote");
  assert.equal(claim.synthesisStatus, "source-fallback");
  assert.equal(result.diagnostics.numericFidelityFailures, 1);
  assert.equal(result.diagnostics.synthesisFallbackClaims, 1);
});

test("falls back when text labeled as a quote is not verbatim", () => {
  const result = synthesizeMemoSections(sections({
    companyId: "applied-digital",
    text: "Applied Digital signed a lease for 400 MW of critical IT load.",
    citationIds: ["evidence-apld"],
    representation: "quote",
  }), [evidence()], ["applied-digital", "nebius"]);
  assert.equal(result.sections[0].claims[0].synthesisStatus, "source-fallback");
  assert.equal(result.diagnostics.quoteFidelityFailures, 1);
});

test("removes repeated claims across memo sections", () => {
  const repeated = {
    companyId: "applied-digital",
    text: "Applied Digital signed a 15-year lease covering 400 MW of critical IT load.",
    citationIds: ["evidence-apld"],
    representation: "quote" as const,
  };
  const result = synthesizeMemoSections([
    { key: "summary", title: "Summary", claims: [repeated] },
    { key: "catalysts", title: "Catalysts", claims: [repeated] },
  ], [evidence()], ["applied-digital", "nebius"]);
  assert.equal(result.sections[0].claims.length, 1);
  assert.equal(result.sections[1].claims.length, 0);
  assert.equal(result.diagnostics.duplicateClaims, 1);
});

test("deterministic synthesis skips malformed slide fragments", () => {
  const claim = createDeterministicMemoClaim(evidence({
    excerpt: "ed sites New colocations Sites >100 MW 2025 ARR guidance. Applied Digital signed a 15-year lease covering 400 MW of critical IT load.",
  }), "exposure");
  assert.equal(claim.text, "Applied Digital signed a 15-year lease covering 400 MW of critical IT load.");
  assert.equal(claim.representation, "quote");
  assert.doesNotMatch(claim.text, /^ed sites/i);
  assert.ok(claim.whyItMatters);
});

test("extracts a concise exact claim from slide-style evidence", () => {
  const claim = createDeterministicMemoClaim(evidence({
    excerpt: "AI Factories Applied Digital has secured $36 Billion In Contracted Lease Value Key Segment Stat $36 billion in total contracted baseline revenue under 15-year take-or-pay lease agreements.",
    topic: "Customers & demand",
  }), "advantages");
  assert.equal(claim.text, "Applied Digital has secured $36 Billion In Contracted Lease Value");
  assert.equal(claim.representation, "quote");
  assert.equal(claim.synthesisStatus, "verified");
});

test("adds the company subject to action fragments extracted from a slide", () => {
  const claim = createDeterministicMemoClaim(evidence({
    excerpt: "Company Timeline 2025 AI Data Center Expansion Signed three 15-year leases for 3 buildings at Polaris Forge 1, utilizing 400 MW of Critical IT load.",
  }), "summary");
  assert.equal(claim.text, "Applied Digital signed three 15-year leases for 3 buildings at Polaris Forge 1, utilizing 400 MW of Critical IT load");
  assert.equal(claim.representation, "paraphrase");
});

test("normalizes escaped quotation marks without changing quote attribution", () => {
  const claim = createDeterministicMemoClaim(evidence({
    companyId: "nebius",
    companyName: "Nebius",
    ticker: "NBIS",
    excerpt: "\\\"AI workloads demand power infrastructure that matches cloud performance,\\\" said the infrastructure provider.",
  }), "exposure");
  assert.equal(claim.representation, "quote");
  assert.doesNotMatch(claim.text, /\\/);
  assert.match(claim.text, /^"AI workloads/);
});
