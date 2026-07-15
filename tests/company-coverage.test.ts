import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyFlowCoverage } from "@/lib/operations/company-coverage";

const company = { id: "applied-digital", name: "Applied Digital", ticker: "APLD" };
const readyCounts = { sec: 15, irCatalog: 3, irDocuments: 3, evidence: 120, accepted: 3, alerts: 10, claims: 5, comparableQuarters: 3, comparisons: 12, briefs: 2 };

test("marks a company ready only when every research flow has coverage", () => {
  const coverage = buildCompanyFlowCoverage(company, readyCounts);
  assert.equal(coverage.ready, true);
  assert.deepEqual(coverage.gaps, []);
  assert.ok(Object.values(coverage.flows).every(Boolean));
});

test("reports memo and temporal-intelligence gaps independently", () => {
  const coverage = buildCompanyFlowCoverage(company, { ...readyCounts, accepted: 0, comparableQuarters: 1 });
  assert.equal(coverage.ready, false);
  assert.equal(coverage.flows.memos, false);
  assert.equal(coverage.flows.intelligence, false);
  assert.deepEqual(coverage.gaps, ["intelligence", "memos"]);
});
