import assert from "node:assert/strict";
import test from "node:test";
import { assessEvidenceQuality, evidenceDuplicateGroup, extractionReadabilityRisk } from "@/lib/research/quality";

test("scores material AI infrastructure disclosures and suggests a relevant claim", () => {
  const assessment = assessEvidenceQuality({
    excerpt: "The company signed a 15-year take-or-pay lease for 200 MW of critical IT capacity, increasing contracted revenue by approximately $2 billion across the new AI data center campus.",
    topic: "Power & capacity", sectionTitle: "Business update", sourceType: "SEC 8-K", sourceQuality: 95,
  });
  assert.ok(assessment.evidenceQualityScore >= 70);
  assert.ok(assessment.relevanceScore >= 60);
  assert.equal(assessment.suggestion?.claimKind, "capacity-growth");
  assert.equal(assessment.suggestion?.impact, "supports");
});

test("flags filing boilerplate and withholds claim suggestions", () => {
  const assessment = assessEvidenceQuality({
    excerpt: "This Current Report shall not constitute an offer to sell or the solicitation of any offer to buy the preferred stock, and a copy will be filed as an exhibit to the annual report.",
    topic: "Financing & liquidity", sectionTitle: "Item 9.01", sourceType: "SEC 8-K", sourceQuality: 95,
  });
  assert.ok(assessment.boilerplateRisk >= 90);
  assert.ok(assessment.evidenceQualityScore < 45);
  assert.equal(assessment.suggestion, null);
});

test("does not map bitcoin-only operating metrics to AI demand", () => {
  const assessment = assessEvidenceQuality({
    excerpt: "Bitcoin mining revenue was $111.2 million and operating hashrate increased to 36.0 EH/s as the company mined 1,450 Bitcoin during the quarter.",
    topic: "Customers & demand", sectionTitle: "Results of operations", sourceType: "SEC 10-Q", sourceQuality: 95,
  });
  assert.notEqual(assessment.suggestion?.claimKind, "demand-growth");
  assert.notEqual(assessment.suggestion?.claimKind, "customer-risk");
  assert.ok(assessment.evidenceQualityScore < 45);
  assert.ok(assessment.relevanceScore < 35);
});

test("groups formatting variants as duplicate evidence", () => {
  assert.equal(evidenceDuplicateGroup("AI capacity: 200 MW."), evidenceDuplicateGroup("AI capacity  200 MW"));
});

test("caps keyword-dense slide fragments that lack readable sentences", () => {
  const excerpt = "Company Timeline 2021 2022 2023 2024 2025 ARR guidance Actual sites 100 MW new colocations GPU capacity customers revenue backlog power capacity 2025 ARR guidance Actual sites 200 MW customers revenue backlog";
  const assessment = assessEvidenceQuality({ excerpt, topic: "Power & capacity", sectionTitle: "Investor presentation", sourceType: "IR presentation", sourceQuality: 97 });
  assert.ok(extractionReadabilityRisk(excerpt) >= 70);
  assert.ok(assessment.evidenceQualityScore < 45);
  assert.equal(assessment.suggestion, null);
});
