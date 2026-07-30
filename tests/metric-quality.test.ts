import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateMetricQualityFixture,
  METRIC_QUALITY_FIXTURES,
  metricQualityGate,
  normalizeCompanyFactsForQualityFixture,
  type MetricQualityRun,
} from "@/lib/company-intelligence/metric-quality";

test("metric quality golden fixtures pass deterministically", () => {
  const results = METRIC_QUALITY_FIXTURES.map(evaluateMetricQualityFixture);
  assert.deepEqual(results.filter((result) => result.status === "failed"), []);
});

test("metric quality Company Facts fixture preserves quarter normalization", () => {
  const facts = normalizeCompanyFactsForQualityFixture();
  assert.equal(facts.length, 1);
  assert.equal(facts[0].metricKey, "revenue");
  assert.equal(facts[0].normalizedValue, 145);
  assert.equal(facts[0].measurementType, "duration");
});

test("metric quality gate blocks anomaly and live-contract regressions", () => {
  const run = {
    overallScore: 95,
    metrics: { classificationAccuracy: 100, valueAccuracy: 100, unitAccuracy: 100, anomalySafety: 75, contractHealth: 75 },
  } as MetricQualityRun;
  const gate = metricQualityGate(run);
  assert.equal(gate.passed, false);
  assert.equal(gate.reasons.length, 2);
});
