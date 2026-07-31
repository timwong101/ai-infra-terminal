import assert from "node:assert/strict";
import test from "node:test";
import { extractionQualityGate, scoreExtractionCase } from "@/lib/extraction-quality/service";
import type { ExtractionBenchmarkCase, ExtractionQualityActual, ExtractionQualityRun } from "@/lib/extraction-quality/types";

const benchmark: ExtractionBenchmarkCase = {
  id: "test:apld:q4", suiteVersion: "test", caseVersion: 1, title: "APLD fiscal period", companyId: "applied-digital",
  sourceKind: "ir", sourceDocumentId: "document", origin: "test", severity: "critical", active: true,
  expectations: {
    minimumSections: 2, minimumPassages: 3, expectedTopics: ["Power & capacity"],
    allowedMetricKeys: ["power_capacity", "revenue"],
    expectedMetrics: [{ metricKey: "revenue", value: 208.2, unit: "USD millions" }],
    forbiddenMetrics: [{ metricKey: "debt", value: 0.001 }],
    expectedPeriod: { periodKind: "quarter", fiscalYear: 2026, fiscalQuarter: 4, periodEnd: "2026-05-31" },
  },
};

function actual(overrides: Partial<ExtractionQualityActual> = {}): ExtractionQualityActual {
  return {
    sections: 2, passages: 3, topics: ["Power & capacity"],
    metrics: [{ metricKey: "revenue", value: 208.2, unit: "USD millions", context: "Revenue was $208.2 million." }],
    commitmentKeys: [],
    period: { label: "Q4 FY2026", periodKind: "quarter", fiscalYear: 2026, fiscalQuarter: 4, periodEnd: "2026-05-31" },
    parserVersion: "test", diff: { beforeSections: 2, afterSections: 2, beforePassages: 3, afterPassages: 3, addedPassages: 0, removedPassages: 0, changedPassages: 0, unchangedPassages: 3, wordCountDelta: 0 },
    ...overrides,
  };
}

test("real-source extraction scoring passes a complete fiscal-period contract", () => {
  const result = scoreExtractionCase(benchmark, actual());
  assert.equal(result.status, "passed");
  assert.equal(result.scores.periodAccuracy, 100);
  assert.equal(result.scores.forbiddenSafety, 100);
});

test("real-source extraction scoring blocks false positives and fiscal-period drift", () => {
  const result = scoreExtractionCase(benchmark, actual({
    metrics: [
      ...actual().metrics,
      { metricKey: "debt", value: 0.001, unit: "USD millions", context: "Per-unit table value." },
    ],
    period: { label: "Calendar Q3 2026", periodKind: "quarter", fiscalYear: 2026, fiscalQuarter: 3, periodEnd: "2026-09-30" },
  }));
  assert.equal(result.status, "failed");
  assert.equal(result.scores.forbiddenSafety, 0);
  assert.equal(result.scores.periodAccuracy, 0);
  assert.match(result.failureReasons.join(" "), /Forbidden debt/);
});

test("parser promotion gate requires perfect false-positive and fiscal-period safety", () => {
  const run = {
    overallScore: 96,
    failedCount: 0,
    metrics: { structure: 100, topicRecall: 100, topicPrecision: 90, metricRecall: 100, metricPrecision: 100, forbiddenSafety: 75, periodAccuracy: 100, commitmentRecall: 100 },
  } as ExtractionQualityRun;
  const gate = extractionQualityGate(run);
  assert.equal(gate.passed, false);
  assert.match(gate.reasons.join(" "), /False-positive safety/);
});
