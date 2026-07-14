import assert from "node:assert/strict";
import test from "node:test";
import { compareDisclosureTone, compareMetricValues, extractMetricsFromText } from "@/lib/company-intelligence/extract";
import { resolveDocumentPeriods, type PeriodDocument } from "@/lib/company-intelligence/period-resolver";
import { periodForDate } from "@/lib/company-intelligence/service";

test("extracts explicit infrastructure and financial metrics with normalized units", () => {
  const metrics = extractMetricsFromText("The company reported $1.2 billion of backlog. Energized data center power capacity reached 250 MW. The fleet includes 12,500 NVIDIA GPUs.");
  assert.deepEqual(metrics.map((item) => [item.metricKey, item.normalizedValue]), [
    ["backlog", 1200],
    ["active_power_capacity", 250],
    ["gpu_count", 12500],
  ]);
});

test("separates active power from planned capacity and excludes market capex estimates", () => {
  const metrics = extractMetricsFromText("We have 175 MW live at the campus and secured a pipeline of 1.2 GW. Hyperscalers capex estimates exceed $700 billion.");
  assert.deepEqual(metrics.map((item) => item.metricKey), ["active_power_capacity", "planned_power_capacity"]);
});

test("does not classify unrelated dollar figures as company metrics", () => {
  const metrics = extractMetricsFromText("The agreement contains a $25 million termination threshold.");
  assert.equal(metrics.length, 0);
});

test("normalizes unscaled dollar figures as dollars rather than millions", () => {
  const metrics = extractMetricsFromText("The company reported revenue of $1,000,000 for the period.");
  assert.equal(metrics.find((item) => item.metricKey === "revenue")?.normalizedValue, 1);
});

test("uses the closest financial label in dense presentation text", () => {
  const metrics = extractMetricsFromText("Positive operating cash flow included $2.3 billion. AI cloud revenue reached $390 million.");
  assert.equal(metrics.find((item) => item.metricKey === "operating_cash_flow")?.displayValue, "$2.3B");
  assert.equal(metrics.find((item) => item.metricKey === "revenue")?.displayValue, "$390M");
});

test("compares normalized values with materiality bands", () => {
  assert.deepEqual(compareMetricValues(125, 100), { direction: "increased", deltaPercent: 25, significance: "high" });
  assert.deepEqual(compareMetricValues(91, 100), { direction: "decreased", deltaPercent: -9, significance: "low" });
  assert.deepEqual(compareMetricValues(102, 100), { direction: "unchanged", deltaPercent: 2, significance: "low" });
  assert.deepEqual(compareMetricValues(50), { direction: "new", deltaPercent: null, significance: "medium" });
});

test("assigns source dates to stable calendar-quarter boundaries", () => {
  assert.deepEqual(periodForDate("2026-05-07"), {
    periodKey: "calendar:2026-Q2", label: "Calendar Q2 2026", calendarYear: 2026, calendarQuarter: 2,
    periodStart: "2026-04-01", periodEnd: "2026-06-30",
  });
  assert.equal(periodForDate("2025-12-31").periodKey, "calendar:2025-Q4");
});

function periodDocument(overrides: Partial<PeriodDocument>): PeriodDocument {
  return {
    companyId: "iren", sourceKind: "sec", sourceDocumentId: "filing", sourceType: "SEC 10-Q",
    documentTitle: "IREN quarterly filing", sourceUrl: "https://example.com/filing", documentDate: "2026-05-08",
    periodOfReport: "2026-03-31", evidenceCount: 4, ...overrides,
  };
}

test("anchors earnings documents to the SEC period of report", () => {
  const resolved = resolveDocumentPeriods([
    periodDocument({}),
    periodDocument({ sourceKind: "ir", sourceDocumentId: "presentation", sourceType: "Presentation", documentTitle: "IREN Q3 FY 26 Results Presentation", sourceUrl: "https://example.com/deck", documentDate: "2026-05-07", periodOfReport: null }),
  ]);
  assert.equal(resolved[0].periodKey, "quarter:2026-03-31");
  assert.equal(resolved[0].resolutionConfidence, 100);
  assert.equal(resolved[1].periodKey, resolved[0].periodKey);
  assert.equal(resolved[1].label, "Q3 FY2026");
  assert.equal(resolved[1].resolutionMethod, "matched-periodic-filing");
});

test("keeps annual periods separate and marks undated news as calendar fallback", () => {
  const resolved = resolveDocumentPeriods([
    periodDocument({ sourceType: "SEC 10-K", periodOfReport: "2025-12-31", documentDate: "2026-03-02" }),
    periodDocument({ sourceKind: "ir", sourceDocumentId: "news", sourceType: "Press Release", documentTitle: "New data center campus announced", sourceUrl: "https://example.com/news", documentDate: "2026-06-03", periodOfReport: null }),
  ]);
  assert.equal(resolved[0].periodKind, "annual");
  assert.equal(resolved[0].periodKey, "annual:2025-12-31");
  assert.equal(resolved[1].periodKind, "calendar-fallback");
  assert.equal(resolved[1].resolutionConfidence, 45);
});

test("identifies stronger and more uncertain disclosure language", () => {
  assert.equal(compareDisclosureTone("We achieved record growth and secured capacity.", "Capacity remained stable."), "stronger");
  assert.equal(compareDisclosureTone("Demand may decline and remains uncertain.", "Demand remained stable."), "more uncertain");
});
