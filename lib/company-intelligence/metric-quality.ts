import { and, asc, desc, eq } from "drizzle-orm";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";
import { extractCompanyFactObservations } from "@/lib/company-intelligence/company-facts";
import { extractMetricsFromText } from "@/lib/company-intelligence/extract";
import { analyzeMetricObservation } from "@/lib/company-intelligence/metric-policy";
import { withDatabase } from "@/lib/db/client";
import { canonicalMetrics, companyMetrics, metricQualityResults, metricQualityRuns } from "@/lib/db/schema";

export const METRIC_QUALITY_SUITE_VERSION = "neocloud-metric-quality-v1";

export type MetricQualityScores = {
  classificationAccuracy: number;
  valueAccuracy: number;
  unitAccuracy: number;
  anomalySafety: number;
  contractHealth: number;
};

export type MetricQualityResult = {
  id: string;
  benchmarkId: string;
  title: string;
  category: string;
  status: "passed" | "failed";
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  failureReasons: string[];
};

export type MetricQualityRun = {
  id: string;
  suiteVersion: string;
  status: "running" | "completed" | "error";
  overallScore: number | null;
  passRate: number | null;
  metrics: MetricQualityScores;
  caseCount: number;
  passedCount: number;
  failedCount: number;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  results: MetricQualityResult[];
};

type Fixture = {
  id: string;
  title: string;
  category: "classification" | "normalization" | "anomaly" | "dimension";
  text?: string;
  expected: { metricKey?: string; value?: number; unit?: string; empty?: boolean; flag?: string; scopeType?: string; periodType?: string };
};

export const METRIC_QUALITY_FIXTURES: Fixture[] = [
  { id: "revenue-total", title: "Quarterly revenue total", category: "normalization", text: "Revenue for the quarter was $145 million.", expected: { metricKey: "revenue", value: 145, unit: "USD millions" } },
  { id: "backlog-total", title: "Contracted backlog", category: "normalization", text: "Remaining performance obligations, or backlog, reached $1.2 billion.", expected: { metricKey: "backlog", value: 1200, unit: "USD millions" } },
  { id: "offering-not-revenue", title: "Securities offering exclusion", category: "anomaly", text: "The prospectus covers the offer and sale of up to $6,000,000,000 of securities. Revenue was discussed elsewhere.", expected: { empty: true } },
  { id: "delta-not-revenue", title: "Revenue component exclusion", category: "anomaly", text: "The decrease in revenue was attributable to a $25.8 million reduction in realized pricing.", expected: { empty: true } },
  { id: "planned-power", title: "Planned power normalization", category: "classification", text: "The planned data center campus has secured 1.2 GW of available power.", expected: { metricKey: "planned_power_capacity", value: 1200, unit: "MW" } },
  { id: "active-power", title: "Active power normalization", category: "classification", text: "The facility now operates 175 MW of energized data center capacity.", expected: { metricKey: "active_power_capacity", value: 175, unit: "MW" } },
  { id: "financing-table-power", title: "Financing table collision", category: "anomaly", text: "Macquarie Transaction Overview capitalization table for the data center issuer lists 1 MW alongside net proceeds.", expected: { empty: true } },
  { id: "facility-scope", title: "Facility scope classification", category: "dimension", expected: { scopeType: "facility" } },
  { id: "quarter-duration", title: "Quarter duration classification", category: "dimension", expected: { periodType: "quarter" } },
  { id: "offering-anomaly", title: "Offering anomaly detection", category: "anomaly", expected: { flag: "financing_amount_misclassified" } },
];

export function evaluateMetricQualityFixture(fixture: Fixture): MetricQualityResult {
  let actual: Record<string, unknown> = {};
  const failures: string[] = [];
  if (fixture.text !== undefined) {
    const metrics = extractMetricsFromText(fixture.text);
    const selected = fixture.expected.metricKey ? metrics.find((item) => item.metricKey === fixture.expected.metricKey) : metrics[0];
    actual = selected ? { metricKey: selected.metricKey, value: selected.normalizedValue, unit: selected.unit, count: metrics.length } : { count: 0 };
    if (fixture.expected.empty && metrics.length) failures.push(`Expected no metric, but extracted ${metrics.map((item) => item.metricKey).join(", ")}.`);
    if (fixture.expected.metricKey && selected?.metricKey !== fixture.expected.metricKey) failures.push(`Expected ${fixture.expected.metricKey}, received ${selected?.metricKey ?? "nothing"}.`);
    if (fixture.expected.value !== undefined && selected?.normalizedValue !== fixture.expected.value) failures.push(`Expected value ${fixture.expected.value}, received ${selected?.normalizedValue ?? "nothing"}.`);
    if (fixture.expected.unit && selected?.unit !== fixture.expected.unit) failures.push(`Expected unit ${fixture.expected.unit}, received ${selected?.unit ?? "nothing"}.`);
  } else {
    const policyInput = fixture.id === "offering-anomaly" ? {
      metricKey: "revenue", normalizedValue: 6000, context: "Prospectus for the offer and sale of $6 billion of securities.", measurementType: "duration", periodStart: "2026-01-01", periodEnd: "2026-03-31", sourceKind: "text",
    } : {
      metricKey: "power_capacity", normalizedValue: 100, context: "The Polaris Forge campus includes a 100 MW data center building.", measurementType: "instant", periodEnd: "2026-03-31", sourceKind: "text",
      periodStart: null,
    };
    if (fixture.id === "quarter-duration") {
      policyInput.measurementType = "duration";
      policyInput.periodStart = "2026-01-01";
    }
    const policy = analyzeMetricObservation(policyInput);
    actual = policy;
    if (fixture.expected.flag && !policy.anomalyFlags.includes(fixture.expected.flag)) failures.push(`Expected anomaly flag ${fixture.expected.flag}.`);
    if (fixture.expected.scopeType && policy.scopeType !== fixture.expected.scopeType) failures.push(`Expected scope ${fixture.expected.scopeType}, received ${policy.scopeType}.`);
    if (fixture.expected.periodType && policy.periodType !== fixture.expected.periodType) failures.push(`Expected period type ${fixture.expected.periodType}, received ${policy.periodType}.`);
  }
  return { id: `metric-quality-result:${crypto.randomUUID()}`, benchmarkId: fixture.id, title: fixture.title, category: fixture.category, status: failures.length ? "failed" : "passed", expected: fixture.expected, actual, failureReasons: failures };
}

function percent(value: number, total: number) { return total ? Math.round(value / total * 100) : 100; }
function average(values: number[]) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }

export async function runMetricQualitySuite(auth: AuthContext) {
  const id = `metric-quality:${crypto.randomUUID()}`;
  const started = performance.now();
  await withDatabase((db) => db.insert(metricQualityRuns).values({ id, workspaceId: auth.workspace.id, ownerUserId: auth.user.id, suiteVersion: METRIC_QUALITY_SUITE_VERSION, caseCount: METRIC_QUALITY_FIXTURES.length + 1 }));
  try {
    const fixtureResults = METRIC_QUALITY_FIXTURES.map(evaluateMetricQualityFixture);
    const live = await withDatabase(async (db) => {
      const metrics = await db.select().from(companyMetrics);
      const canonical = await db.select().from(canonicalMetrics);
      const canonicalIds = new Set(canonical.map((item) => item.metricId));
      return {
        observations: metrics.length,
        autoAccepted: metrics.filter((item) => item.reviewStatus === "accepted" && !item.reviewedAt).length,
        anomalousCanonical: metrics.filter((item) => canonicalIds.has(item.id) && (!item.canonicalEligible || item.anomalyScore > 0)).length,
        dimensionCoverage: percent(metrics.filter((item) => item.scopeType && item.periodType && item.extractorVersion).length, metrics.length),
      };
    });
    if (!live) throw new Error("Postgres is required for metric quality checks.");
    const liveFailures: string[] = [];
    if (live.autoAccepted) liveFailures.push(`${live.autoAccepted} observations were accepted without a metric-level review.`);
    if (live.anomalousCanonical) liveFailures.push(`${live.anomalousCanonical} anomalous observations are canonical.`);
    if (live.dimensionCoverage < 100) liveFailures.push(`Metric dimension coverage is ${live.dimensionCoverage}%.`);
    const liveResult: MetricQualityResult = { id: `metric-quality-result:${crypto.randomUUID()}`, benchmarkId: "live-data-contracts", title: "Live metric data contracts", category: "data-contract", status: liveFailures.length ? "failed" : "passed", expected: { autoAccepted: 0, anomalousCanonical: 0, dimensionCoverage: 100 }, actual: live, failureReasons: liveFailures };
    const results = [...fixtureResults, liveResult];
    const categories = (name: string) => fixtureResults.filter((item) => item.category === name);
    const metrics: MetricQualityScores = {
      classificationAccuracy: percent(categories("classification").filter((item) => item.status === "passed").length, categories("classification").length),
      valueAccuracy: percent(categories("normalization").filter((item) => item.status === "passed").length, categories("normalization").length),
      unitAccuracy: percent(fixtureResults.filter((item) => "unit" in item.expected && item.status === "passed").length, fixtureResults.filter((item) => "unit" in item.expected).length),
      anomalySafety: percent(categories("anomaly").filter((item) => item.status === "passed").length, categories("anomaly").length),
      contractHealth: liveResult.status === "passed" ? 100 : Math.max(0, 100 - liveFailures.length * 25),
    };
    const overallScore = average(Object.values(metrics));
    const passedCount = results.filter((item) => item.status === "passed").length;
    const passRate = percent(passedCount, results.length);
    await withDatabase(async (db) => {
      await db.insert(metricQualityResults).values(results.map((item) => ({ id: item.id, runId: id, benchmarkId: item.benchmarkId, title: item.title, category: item.category, status: item.status, expected: item.expected, actual: item.actual, failureReasons: item.failureReasons })));
      await db.update(metricQualityRuns).set({ status: "completed", overallScore, passRate, metrics, passedCount, failedCount: results.length - passedCount, durationMs: Math.max(1, Math.round(performance.now() - started)), completedAt: new Date() }).where(eq(metricQualityRuns.id, id));
    });
    await recordAuditEvent(auth, { action: "metric_quality.completed", entityType: "metric_quality_run", entityId: id, summary: `Completed ${METRIC_QUALITY_SUITE_VERSION} with ${overallScore}/100.`, metadata: { passRate, caseCount: results.length } });
    return getMetricQualityRun(id, auth.workspace.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Metric quality run failed.";
    await withDatabase((db) => db.update(metricQualityRuns).set({ status: "error", error: message, durationMs: Math.max(1, Math.round(performance.now() - started)), completedAt: new Date() }).where(eq(metricQualityRuns.id, id)));
    throw error;
  }
}

function resultFromRow(row: typeof metricQualityResults.$inferSelect): MetricQualityResult {
  return { id: row.id, benchmarkId: row.benchmarkId, title: row.title, category: row.category, status: row.status as MetricQualityResult["status"], expected: row.expected as Record<string, unknown>, actual: row.actual as Record<string, unknown>, failureReasons: row.failureReasons as string[] };
}

function runFromRow(row: typeof metricQualityRuns.$inferSelect, results: MetricQualityResult[] = []): MetricQualityRun {
  return { id: row.id, suiteVersion: row.suiteVersion, status: row.status as MetricQualityRun["status"], overallScore: row.overallScore, passRate: row.passRate, metrics: row.metrics as MetricQualityScores, caseCount: row.caseCount, passedCount: row.passedCount, failedCount: row.failedCount, durationMs: row.durationMs, error: row.error, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, results };
}

export async function listMetricQualityRuns(workspaceId: string) {
  const rows = await withDatabase((db) => db.select().from(metricQualityRuns).where(eq(metricQualityRuns.workspaceId, workspaceId)).orderBy(desc(metricQualityRuns.createdAt)).limit(20));
  if (!rows) throw new Error("Postgres is required for metric quality history.");
  return rows.map((row) => runFromRow(row));
}

export async function getMetricQualityRun(id: string, workspaceId: string) {
  const result = await withDatabase(async (db) => {
    const run = (await db.select().from(metricQualityRuns).where(and(eq(metricQualityRuns.id, id), eq(metricQualityRuns.workspaceId, workspaceId))).limit(1))[0];
    if (!run) return null;
    const rows = await db.select().from(metricQualityResults).where(eq(metricQualityResults.runId, id)).orderBy(asc(metricQualityResults.createdAt));
    return runFromRow(run, rows.map(resultFromRow));
  });
  if (!result) throw new Error("Metric quality run not found.");
  return result;
}

export function metricQualityGate(run: MetricQualityRun) {
  const reasons: string[] = [];
  if ((run.overallScore ?? 0) < 90) reasons.push(`Overall score ${run.overallScore ?? 0} is below 90.`);
  if ((run.metrics.anomalySafety ?? 0) < 100) reasons.push("Anomaly safety must remain at 100%.");
  if ((run.metrics.contractHealth ?? 0) < 100) reasons.push("Live metric contracts must remain healthy.");
  return { passed: reasons.length === 0, reasons };
}

export function normalizeCompanyFactsForQualityFixture() {
  return extractCompanyFactObservations({ cik: 123456, facts: { "us-gaap": { Revenues: { units: { USD: [{ start: "2026-01-01", end: "2026-03-31", val: 145_000_000, accn: "0000123456-26-000001", form: "10-Q", filed: "2026-05-01" }] } } } } });
}
