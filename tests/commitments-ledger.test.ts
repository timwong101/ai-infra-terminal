import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCommitmentVariance,
  classifyCommitmentRevision,
  compatibleOutcomeMetricKeys,
  commitmentIdentityKey,
  extractCommitmentCandidates,
  resolveCommitmentTargetDate,
} from "@/lib/company-intelligence/commitments/policy";

test("extracts a dated, normalized infrastructure commitment", () => {
  const candidates = extractCommitmentCandidates("IREN expects active power capacity across its data centers to reach 300 MW by the end of 2027.");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].metricKey, "active_power_capacity");
  assert.equal(candidates[0].targetValue, 300);
  assert.equal(candidates[0].targetPeriodEnd, "2027-12-31");
  assert.equal(candidates[0].targetDatePrecision, "year");
  assert.ok(candidates[0].confidence >= 80);
});

test("extracts ARR guidance without treating unrelated reported values as commitments", () => {
  const candidates = extractCommitmentCandidates("IREN targets $4.4 billion in ARR by 2026. Revenue was $90 million in the quarter.");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].metricKey, "annual_recurring_revenue");
  assert.equal(candidates[0].targetValue, 4400);
  assert.equal(candidates[0].targetUnit, "USD millions");
  assert.equal(extractCommitmentCandidates("Revenue was $90 million in the quarter.").length, 0);
});

test("resolves quarter, month, year, and undated target periods", () => {
  assert.deepEqual(resolveCommitmentTargetDate("expected by Q3 2027"), { targetPeriodEnd: "2027-09-30", targetDatePrecision: "quarter" });
  assert.deepEqual(resolveCommitmentTargetDate("expected by June 2027"), { targetPeriodEnd: "2027-06-30", targetDatePrecision: "day" });
  assert.deepEqual(resolveCommitmentTargetDate("expected in FY2028"), { targetPeriodEnd: "2028-12-31", targetDatePrecision: "year" });
  assert.deepEqual(resolveCommitmentTargetDate("expected over time"), { targetPeriodEnd: null, targetDatePrecision: "undated" });
});

test("keeps identity stable when value or target date changes", () => {
  const original = extractCommitmentCandidates("The company expects active power capacity at its data centers to reach 300 MW by 2027.")[0];
  const revised = extractCommitmentCandidates("The company now expects active power capacity at its data centers to reach 400 MW by 2028.")[0];
  assert.equal(commitmentIdentityKey(original), commitmentIdentityKey(revised));
});

test("classifies reiterations, raises, reductions, and delays deterministically", () => {
  const base = extractCommitmentCandidates("The company expects active power capacity at its data centers to reach 300 MW by 2027.")[0];
  assert.equal(classifyCommitmentRevision(base, { ...base }), "reiterated");
  assert.equal(classifyCommitmentRevision(base, { ...base, targetValue: 350 }), "raised");
  assert.equal(classifyCommitmentRevision(base, { ...base, targetValue: 250 }), "lowered");
  assert.equal(classifyCommitmentRevision(base, { ...base, targetPeriodEnd: "2028-12-31" }), "delayed");
});

test("calculates signed outcome variance and protects zero targets", () => {
  assert.equal(calculateCommitmentVariance(300, 330), 10);
  assert.equal(calculateCommitmentVariance(300, 240), -20);
  assert.equal(calculateCommitmentVariance(0, 100), null);
});

test("maps planned capacity commitments only to delivered capacity metrics", () => {
  assert.deepEqual(compatibleOutcomeMetricKeys("planned_power_capacity"), ["active_power_capacity", "power_capacity"]);
  assert.deepEqual(compatibleOutcomeMetricKeys("annual_recurring_revenue"), ["annual_recurring_revenue"]);
});
