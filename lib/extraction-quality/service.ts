import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";
import { createSourceExtractionPreview } from "@/lib/artifacts/service";
import type { ExtractionSnapshot } from "@/lib/artifacts/types";
import { extractCommitmentCandidates, commitmentIdentityKey } from "@/lib/company-intelligence/commitments/policy";
import { extractMetricsFromText } from "@/lib/company-intelligence/extract";
import { resolveDocumentPeriods, type PeriodDocument } from "@/lib/company-intelligence/period-resolver";
import { withDatabase } from "@/lib/db/client";
import {
  EXTRACTION_PARSER_CANDIDATE,
  EXTRACTION_QUALITY_SUITE_VERSION,
  extractionBenchmarkCorpus,
} from "@/lib/extraction-quality/corpus";
import {
  extractionBenchmarkCases,
  extractionQualityResults,
  extractionQualityRuns,
  parserReleases,
} from "@/lib/extraction-quality/schema";
import type {
  ExpectedMetric,
  ExtractionBenchmarkCase,
  ExtractionQualityActual,
  ExtractionQualityResult,
  ExtractionQualityRun,
  ExtractionQualityScores,
  ForbiddenMetric,
  ParserRelease,
} from "@/lib/extraction-quality/types";

function percentage(value: number, total: number) { return total ? Math.round(value / total * 100) : 100; }
function average(values: number[]) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
function withinTolerance(actual: number, expected: number, tolerancePercent = 0) {
  const tolerance = Math.abs(expected) * tolerancePercent / 100;
  return Math.abs(actual - expected) <= Math.max(tolerance, 0.000001);
}

function metricMatch(actual: ExtractionQualityActual["metrics"][number], expected: ExpectedMetric | ForbiddenMetric) {
  return actual.metricKey === expected.metricKey
    && (!("unit" in expected) || actual.unit === expected.unit)
    && (expected.value === undefined || withinTolerance(actual.value, expected.value, expected.tolerancePercent));
}

function periodDocument(snapshot: ExtractionSnapshot): PeriodDocument {
  const content = snapshot.sections.flatMap((section) => section.passages.map((passage) => passage.text)).join(" ");
  if ("filingId" in snapshot) return {
    companyId: snapshot.companyId, sourceKind: "sec", sourceDocumentId: snapshot.filingId,
    sourceType: `SEC ${snapshot.formType}`, documentTitle: snapshot.documentTitle, sourceUrl: snapshot.sourceUrl,
    documentDate: snapshot.filedAt, periodOfReport: snapshot.periodOfReport ?? null, content, evidenceCount: 0,
  };
  return {
    companyId: snapshot.companyId, sourceKind: "ir", sourceDocumentId: snapshot.documentId,
    sourceType: snapshot.documentType, documentTitle: snapshot.title, sourceUrl: snapshot.sourceUrl,
    documentDate: snapshot.publishedAt, periodOfReport: null, content, evidenceCount: 0,
  };
}

export function inspectExtractionSnapshot(snapshot: ExtractionSnapshot, parserVersion: string, diff: ExtractionQualityActual["diff"]): ExtractionQualityActual {
  const passages = snapshot.sections.flatMap((section) => section.passages.map((passage) => passage.text));
  const metrics = new Map<string, ExtractionQualityActual["metrics"][number]>();
  const commitments = new Set<string>();
  for (const passage of passages) {
    for (const metric of extractMetricsFromText(passage)) {
      const key = `${metric.metricKey}:${metric.normalizedValue}:${metric.unit}`;
      metrics.set(key, { metricKey: metric.metricKey, value: metric.normalizedValue, unit: metric.unit, context: metric.context });
    }
    for (const candidate of extractCommitmentCandidates(passage)) commitments.add(commitmentIdentityKey(candidate));
  }
  const resolved = resolveDocumentPeriods([periodDocument(snapshot)])[0];
  return {
    sections: snapshot.sections.length,
    passages: passages.length,
    topics: [...new Set(snapshot.sections.map((section) => section.category))].sort(),
    metrics: [...metrics.values()].sort((left, right) => left.metricKey.localeCompare(right.metricKey) || left.value - right.value),
    commitmentKeys: [...commitments].sort(),
    period: resolved ? {
      label: resolved.label, periodKind: resolved.periodKind, fiscalYear: resolved.fiscalYear,
      fiscalQuarter: resolved.fiscalQuarter, periodEnd: resolved.periodEnd,
    } : null,
    parserVersion,
    diff,
  };
}

export function scoreExtractionCase(benchmark: ExtractionBenchmarkCase, actual: ExtractionQualityActual) {
  const expected = benchmark.expectations;
  const allowedTopics = expected.allowedTopics ?? expected.expectedTopics;
  const topicMatches = expected.expectedTopics.filter((topic) => actual.topics.includes(topic)).length;
  const allowedTopicMatches = actual.topics.filter((topic) => allowedTopics.includes(topic)).length;
  const metricMatches = expected.expectedMetrics.filter((metric) => actual.metrics.some((item) => metricMatch(item, metric))).length;
  const allowedMetricMatches = actual.metrics.filter((metric) => expected.allowedMetricKeys.includes(metric.metricKey)).length;
  const forbidden = (expected.forbiddenMetrics ?? []).filter((metric) => actual.metrics.some((item) => metricMatch(item, metric)));
  const expectedCommitments = expected.expectedCommitmentKeys ?? [];
  const periodMatches = !expected.expectedPeriod || Boolean(actual.period
    && actual.period.periodKind === expected.expectedPeriod.periodKind
    && actual.period.fiscalYear === expected.expectedPeriod.fiscalYear
    && actual.period.fiscalQuarter === expected.expectedPeriod.fiscalQuarter
    && actual.period.periodEnd === expected.expectedPeriod.periodEnd);
  const structure = Math.round((Math.min(100, percentage(actual.sections, expected.minimumSections)) + Math.min(100, percentage(actual.passages, expected.minimumPassages))) / 2);
  const scores: ExtractionQualityScores = {
    structure,
    topicRecall: percentage(topicMatches, expected.expectedTopics.length),
    topicPrecision: percentage(allowedTopicMatches, actual.topics.length),
    metricRecall: percentage(metricMatches, expected.expectedMetrics.length),
    metricPrecision: percentage(allowedMetricMatches, actual.metrics.length),
    forbiddenSafety: forbidden.length ? 0 : 100,
    periodAccuracy: periodMatches ? 100 : 0,
    commitmentRecall: percentage(expectedCommitments.filter((key) => actual.commitmentKeys.includes(key)).length, expectedCommitments.length),
    overall: 0,
  };
  scores.overall = Math.round(
    scores.structure * .10 + scores.topicRecall * .10 + scores.topicPrecision * .05
    + scores.metricRecall * .25 + scores.metricPrecision * .15 + scores.forbiddenSafety * .15
    + scores.periodAccuracy * .10 + scores.commitmentRecall * .10,
  );
  const failureReasons: string[] = [];
  if (actual.sections < expected.minimumSections || actual.passages < expected.minimumPassages) failureReasons.push(`Extraction returned ${actual.sections} sections and ${actual.passages} passages; expected at least ${expected.minimumSections} and ${expected.minimumPassages}.`);
  for (const topic of expected.expectedTopics) if (!actual.topics.includes(topic)) failureReasons.push(`Required topic ${topic} was not extracted.`);
  for (const metric of expected.expectedMetrics) if (!actual.metrics.some((item) => metricMatch(item, metric))) failureReasons.push(`Expected ${metric.metricKey}=${metric.value} ${metric.unit} was not extracted.`);
  for (const metric of forbidden) failureReasons.push(`Forbidden ${metric.metricKey}${metric.value === undefined ? "" : `=${metric.value}`} was extracted.`);
  for (const key of expectedCommitments) if (!actual.commitmentKeys.includes(key)) failureReasons.push(`Expected commitment ${key} was not extracted.`);
  if (!periodMatches) failureReasons.push(`Resolved period ${actual.period?.periodEnd ?? "none"} did not match ${expected.expectedPeriod?.periodEnd}.`);
  if (scores.metricPrecision < 80) failureReasons.push(`Only ${scores.metricPrecision}% of extracted metric observations use labeled keys for this source.`);
  const criticalFailure = failureReasons.some((reason) => /Expected |Forbidden |Resolved period|Required topic|Extraction returned/.test(reason));
  return { scores, failureReasons, status: scores.overall >= 85 && !criticalFailure ? "passed" as const : "failed" as const };
}

async function ensureBenchmarkCorpus() {
  const corpus = extractionBenchmarkCorpus();
  const result = await withDatabase(async (db) => {
    await db.update(extractionBenchmarkCases).set({ active: false, updatedAt: new Date() })
      .where(ne(extractionBenchmarkCases.suiteVersion, corpus[0].suiteVersion));
    for (const item of corpus) await db.insert(extractionBenchmarkCases).values(item).onConflictDoUpdate({
      target: extractionBenchmarkCases.id,
      set: {
        suiteVersion: item.suiteVersion, caseVersion: item.caseVersion, title: item.title, companyId: item.companyId,
        sourceKind: item.sourceKind, sourceDocumentId: item.sourceDocumentId, origin: item.origin, severity: item.severity,
        expectations: item.expectations, active: item.active, updatedAt: new Date(),
      },
    });
    return db.select().from(extractionBenchmarkCases).where(eq(extractionBenchmarkCases.active, true)).orderBy(asc(extractionBenchmarkCases.companyId), asc(extractionBenchmarkCases.title));
  });
  if (!result) throw new Error("Postgres is required for extraction quality benchmarks.");
  const activeIds = new Set(corpus.map((item) => item.id));
  return result.filter((item) => activeIds.has(item.id)).map((item): ExtractionBenchmarkCase => ({
    ...item, sourceKind: item.sourceKind as ExtractionBenchmarkCase["sourceKind"], severity: item.severity as ExtractionBenchmarkCase["severity"],
    expectations: item.expectations as ExtractionBenchmarkCase["expectations"],
  }));
}

function zeroScores(): ExtractionQualityScores {
  return { structure: 0, topicRecall: 0, topicPrecision: 0, metricRecall: 0, metricPrecision: 0, forbiddenSafety: 0, periodAccuracy: 0, commitmentRecall: 0, overall: 0 };
}

async function evaluateBenchmark(benchmark: ExtractionBenchmarkCase): Promise<ExtractionQualityResult> {
  const started = Date.now();
  try {
    const replay = await createSourceExtractionPreview(benchmark.sourceKind, benchmark.sourceDocumentId);
    const actual = inspectExtractionSnapshot(replay.preview, `${EXTRACTION_PARSER_CANDIDATE} · ${replay.run.parserVersion}`, replay.run.diffSummary as ExtractionQualityActual["diff"]);
    const scored = scoreExtractionCase(benchmark, actual);
    return {
      id: `extraction-quality-result:${crypto.randomUUID()}`, benchmarkId: benchmark.id, companyId: benchmark.companyId,
      sourceKind: benchmark.sourceKind, sourceDocumentId: benchmark.sourceDocumentId, title: benchmark.title, status: scored.status,
      artifactHash: replay.source.artifact.contentHash, extractionRunId: replay.run.id, scores: scored.scores,
      expected: benchmark.expectations, actual, failureReasons: scored.failureReasons, durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      id: `extraction-quality-result:${crypto.randomUUID()}`, benchmarkId: benchmark.id, companyId: benchmark.companyId,
      sourceKind: benchmark.sourceKind, sourceDocumentId: benchmark.sourceDocumentId, title: benchmark.title, status: "failed",
      artifactHash: null, extractionRunId: null, scores: zeroScores(), expected: benchmark.expectations,
      actual: { error: error instanceof Error ? error.message : "Unable to evaluate source." },
      failureReasons: [error instanceof Error ? error.message : "Unable to evaluate source."], durationMs: Date.now() - started,
    };
  }
}

function metricsFromResults(results: ExtractionQualityResult[]) {
  const names = ["structure", "topicRecall", "topicPrecision", "metricRecall", "metricPrecision", "forbiddenSafety", "periodAccuracy", "commitmentRecall"] as const;
  return Object.fromEntries(names.map((name) => [name, average(results.map((item) => item.scores[name]))])) as Omit<ExtractionQualityScores, "overall">;
}

export async function runExtractionQualitySuite(auth: AuthContext) {
  const benchmarks = await ensureBenchmarkCorpus();
  const runId = `extraction-quality:${crypto.randomUUID()}`;
  const started = Date.now();
  await withDatabase((db) => db.insert(extractionQualityRuns).values({
    id: runId, workspaceId: auth.workspace.id, ownerUserId: auth.user.id, suiteVersion: process.env.E2E_TEST === "1" ? `${EXTRACTION_QUALITY_SUITE_VERSION}-fixture` : EXTRACTION_QUALITY_SUITE_VERSION,
    parserVersion: EXTRACTION_PARSER_CANDIDATE, caseCount: benchmarks.length,
  }));
  try {
    const results: ExtractionQualityResult[] = [];
    for (const benchmark of benchmarks) results.push(await evaluateBenchmark(benchmark));
    const metrics = metricsFromResults(results);
    const overallScore = average(results.map((item) => item.scores.overall));
    const passedCount = results.filter((item) => item.status === "passed").length;
    const passRate = percentage(passedCount, results.length);
    const candidatePassed = passedCount === results.length && overallScore >= 90
      && metrics.forbiddenSafety === 100 && metrics.periodAccuracy === 100 && metrics.metricRecall >= 90;
    await withDatabase(async (db) => {
      await db.insert(extractionQualityResults).values(results.map((item) => ({
        id: item.id, runId, benchmarkId: item.benchmarkId, companyId: item.companyId, sourceKind: item.sourceKind,
        sourceDocumentId: item.sourceDocumentId, title: item.title, status: item.status, artifactHash: item.artifactHash,
        extractionRunId: item.extractionRunId, scores: item.scores, expected: item.expected, actual: item.actual,
        failureReasons: item.failureReasons, durationMs: item.durationMs,
      })));
      await db.update(extractionQualityRuns).set({
        status: "completed", overallScore, passRate, metrics, passedCount, failedCount: results.length - passedCount,
        durationMs: Date.now() - started, completedAt: new Date(),
      }).where(eq(extractionQualityRuns.id, runId));
      await db.insert(parserReleases).values({
        id: `parser-release:${runId}`, parserVersion: EXTRACTION_PARSER_CANDIDATE, benchmarkRunId: runId,
        status: candidatePassed ? "candidate" : "blocked", qualityScore: overallScore,
        releaseNotes: `Evaluated ${results.length} immutable real-source cases; ${passedCount} passed.`,
      });
    });
    await recordAuditEvent(auth, {
      action: "extraction_quality.completed", entityType: "extraction_quality_run", entityId: runId,
      summary: `Evaluated ${EXTRACTION_PARSER_CANDIDATE} against ${results.length} immutable source cases with ${overallScore}/100.`,
      metadata: { passRate, passedCount, failedCount: results.length - passedCount },
    });
    return getExtractionQualityRun(runId, auth.workspace.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Extraction quality run failed.";
    await withDatabase((db) => db.update(extractionQualityRuns).set({ status: "error", error: message, durationMs: Date.now() - started, completedAt: new Date() }).where(eq(extractionQualityRuns.id, runId)));
    throw error;
  }
}

function resultFromRow(row: typeof extractionQualityResults.$inferSelect): ExtractionQualityResult {
  return {
    id: row.id, benchmarkId: row.benchmarkId, companyId: row.companyId, sourceKind: row.sourceKind as ExtractionQualityResult["sourceKind"],
    sourceDocumentId: row.sourceDocumentId, title: row.title, status: row.status as ExtractionQualityResult["status"],
    artifactHash: row.artifactHash, extractionRunId: row.extractionRunId, scores: row.scores as ExtractionQualityScores,
    expected: row.expected as ExtractionQualityResult["expected"], actual: row.actual as ExtractionQualityResult["actual"],
    failureReasons: row.failureReasons as string[], durationMs: row.durationMs,
  };
}

function runFromRow(row: typeof extractionQualityRuns.$inferSelect, results: ExtractionQualityResult[] = []): ExtractionQualityRun {
  return {
    id: row.id, suiteVersion: row.suiteVersion, parserVersion: row.parserVersion, status: row.status as ExtractionQualityRun["status"],
    overallScore: row.overallScore, passRate: row.passRate, metrics: row.metrics as ExtractionQualityRun["metrics"],
    caseCount: row.caseCount, passedCount: row.passedCount, failedCount: row.failedCount, durationMs: row.durationMs,
    error: row.error, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, results,
  };
}

export async function listExtractionQualityRuns(workspaceId: string) {
  const rows = await withDatabase((db) => db.select().from(extractionQualityRuns).where(eq(extractionQualityRuns.workspaceId, workspaceId)).orderBy(desc(extractionQualityRuns.startedAt)).limit(20));
  if (!rows) throw new Error("Postgres is required for extraction quality history.");
  return rows.map((row) => runFromRow(row));
}

export async function getExtractionQualityRun(id: string, workspaceId: string) {
  const result = await withDatabase(async (db) => {
    const run = (await db.select().from(extractionQualityRuns).where(and(eq(extractionQualityRuns.id, id), eq(extractionQualityRuns.workspaceId, workspaceId))).limit(1))[0];
    if (!run) return null;
    const rows = await db.select().from(extractionQualityResults).where(eq(extractionQualityResults.runId, id)).orderBy(asc(extractionQualityResults.companyId), asc(extractionQualityResults.title));
    return runFromRow(run, rows.map(resultFromRow));
  });
  if (!result) throw new Error("Extraction quality run not found.");
  return result;
}

export async function listExtractionBenchmarkCases() { return extractionBenchmarkCorpus(); }

function releaseFromRow(row: typeof parserReleases.$inferSelect): ParserRelease {
  return { id: row.id, parserVersion: row.parserVersion, benchmarkRunId: row.benchmarkRunId, status: row.status, qualityScore: row.qualityScore, releaseNotes: row.releaseNotes, promotedAt: row.promotedAt?.toISOString() ?? null };
}

export async function listParserReleases(workspaceId: string) {
  const rows = await withDatabase((db) => db.select({ release: parserReleases }).from(parserReleases)
    .innerJoin(extractionQualityRuns, eq(parserReleases.benchmarkRunId, extractionQualityRuns.id))
    .where(eq(extractionQualityRuns.workspaceId, workspaceId)).orderBy(desc(parserReleases.createdAt)));
  if (!rows) throw new Error("Postgres is required for parser release history.");
  return rows.map((row) => releaseFromRow(row.release));
}

export function extractionQualityGate(run: ExtractionQualityRun) {
  const reasons: string[] = [];
  if ((run.overallScore ?? 0) < 90) reasons.push(`Overall score ${run.overallScore ?? 0} is below 90.`);
  if (run.failedCount > 0) reasons.push(`${run.failedCount} real-source case${run.failedCount === 1 ? " is" : "s are"} failing.`);
  if (run.metrics.forbiddenSafety < 100) reasons.push("False-positive safety must remain at 100%.");
  if (run.metrics.periodAccuracy < 100) reasons.push("Fiscal-period accuracy must remain at 100%.");
  if (run.metrics.metricRecall < 90) reasons.push("Critical metric recall must remain at or above 90%.");
  return { passed: reasons.length === 0, reasons };
}

export async function promoteParserRelease(runId: string, auth: AuthContext) {
  const run = await getExtractionQualityRun(runId, auth.workspace.id);
  const gate = extractionQualityGate(run);
  if (!gate.passed) throw new Error(`Parser promotion is blocked: ${gate.reasons.join(" ")}`);
  const promoted = await withDatabase(async (db) => db.transaction(async (tx) => {
    const release = (await tx.select().from(parserReleases).where(eq(parserReleases.benchmarkRunId, runId)).limit(1))[0];
    if (!release || release.status === "blocked") throw new Error("This benchmark does not have a promotable parser candidate.");
    if (release.status === "promoted") return release;
    const workspaceReleaseIds = (await tx.select({ id: parserReleases.id }).from(parserReleases)
      .innerJoin(extractionQualityRuns, eq(parserReleases.benchmarkRunId, extractionQualityRuns.id))
      .where(and(eq(extractionQualityRuns.workspaceId, auth.workspace.id), eq(parserReleases.status, "promoted"), ne(parserReleases.id, release.id))))
      .map((item) => item.id);
    if (workspaceReleaseIds.length) await tx.update(parserReleases).set({ status: "retired" }).where(inArray(parserReleases.id, workspaceReleaseIds));
    return (await tx.update(parserReleases).set({ status: "promoted", promotedByUserId: auth.user.id, promotedAt: new Date() }).where(eq(parserReleases.id, release.id)).returning())[0];
  }));
  if (!promoted) throw new Error("Postgres is required to promote parser releases.");
  await recordAuditEvent(auth, {
    action: "parser_release.promoted", entityType: "parser_release", entityId: promoted.id,
    summary: `Promoted ${promoted.parserVersion} after passing the immutable source benchmark.`,
    metadata: { benchmarkRunId: runId, qualityScore: promoted.qualityScore },
  });
  return releaseFromRow(promoted);
}
