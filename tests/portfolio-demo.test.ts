import assert from "node:assert/strict";
import test from "node:test";
import { selectPortfolioBaselineEvidence, type PortfolioEvidenceCandidate } from "@/lib/demo/portfolio-seed";

function candidate(overrides: Partial<PortfolioEvidenceCandidate> & Pick<PortfolioEvidenceCandidate, "id">): PortfolioEvidenceCandidate {
  return {
    companyId: "coreweave",
    topic: "Power & capacity",
    sourceKind: "sec",
    reviewStatus: "unreviewed",
    evidenceQualityScore: 70,
    specificityScore: 60,
    documentDate: "2026-01-01",
    ...overrides,
  };
}

test("selectPortfolioBaselineEvidence fills each uncovered source cell with its strongest unreviewed item", () => {
  const selected = selectPortfolioBaselineEvidence([
    candidate({ id: "lower", evidenceQualityScore: 60 }),
    candidate({ id: "strongest", evidenceQualityScore: 90 }),
    candidate({ id: "accepted", topic: "Customers & demand", reviewStatus: "accepted" }),
    candidate({ id: "not-needed", topic: "Customers & demand", evidenceQualityScore: 99 }),
    candidate({ id: "rejected", topic: "Financing & liquidity", reviewStatus: "rejected", evidenceQualityScore: 100 }),
    candidate({ id: "eligible-financing", topic: "Financing & liquidity", evidenceQualityScore: 65 }),
    candidate({ id: "ir-cell", sourceKind: "ir", evidenceQualityScore: 55 }),
  ]);

  assert.deepEqual(new Set(selected), new Set(["strongest", "eligible-financing", "ir-cell"]));
  assert.equal(selected.includes("rejected"), false);
  assert.equal(selected.includes("not-needed"), false);
});
