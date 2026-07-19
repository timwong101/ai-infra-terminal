import { asc, desc, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { researchQualityResults, researchQualityRuns } from "@/lib/db/schema";
import { runResearchAssistantPipeline, type ResearchAssistantEngine } from "@/lib/research/research-assistant";
import type { ResearchAssistantClaim, ResearchEvidenceItem, ResearchQualityResult, ResearchQualityRun, ResearchQualityScores } from "@/lib/research/types";

export const RESEARCH_QUALITY_SUITE_VERSION = "neocloud-grounding-v1";

const TRACKED_COMPANIES = [
  { id: "coreweave", name: "CoreWeave" },
  { id: "nebius", name: "Nebius" },
  { id: "applied-digital", name: "Applied Digital" },
  { id: "iren", name: "IREN" },
] as const;

const TOPICS = {
  capacity: "Power & capacity",
  demand: "Customers & demand",
  financing: "Financing & liquidity",
} as const;

export type ResearchQualityBenchmark = {
  id: string;
  title: string;
  category: "retrieval" | "synthesis" | "comparison" | "source-policy" | "insufficiency";
  question: string;
  filters: {
    companyIds: string[];
    topic: string;
    sourceKinds: Array<"sec" | "ir">;
    dateFrom?: string;
  };
  expectations: {
    topics: string[];
    behavior: "answer" | "insufficient";
    minimumCitations: number;
  };
};

function companyBenchmarks(company: (typeof TRACKED_COMPANIES)[number]): ResearchQualityBenchmark[] {
  const base = { companyIds: [company.id], sourceKinds: [] as Array<"sec" | "ir"> };
  return [
    { id: `${company.id}:capacity`, title: `${company.name} capacity retrieval`, category: "retrieval", question: `What has ${company.name} disclosed about active and planned AI data center capacity?`, filters: { ...base, topic: TOPICS.capacity }, expectations: { topics: [TOPICS.capacity], behavior: "answer", minimumCitations: 1 } },
    { id: `${company.id}:demand`, title: `${company.name} demand retrieval`, category: "retrieval", question: `What accepted evidence supports customer demand or contracted backlog at ${company.name}?`, filters: { ...base, topic: TOPICS.demand }, expectations: { topics: [TOPICS.demand], behavior: "answer", minimumCitations: 1 } },
    { id: `${company.id}:financing`, title: `${company.name} financing retrieval`, category: "retrieval", question: `What does the evidence say about ${company.name}'s liquidity, debt, and funding risk?`, filters: { ...base, topic: TOPICS.financing }, expectations: { topics: [TOPICS.financing], behavior: "answer", minimumCitations: 1 } },
    { id: `${company.id}:synthesis`, title: `${company.name} thesis synthesis`, category: "synthesis", question: `Summarize ${company.name}'s capacity, demand, and financing evidence without adding unsupported forecasts.`, filters: { ...base, topic: "All topics" }, expectations: { topics: Object.values(TOPICS), behavior: "answer", minimumCitations: 3 } },
    { id: `${company.id}:ir-policy`, title: `${company.name} IR source policy`, category: "source-policy", question: `Using only investor-relations evidence, summarize ${company.name}'s disclosed infrastructure position.`, filters: { ...base, topic: "All topics", sourceKinds: ["ir"] }, expectations: { topics: Object.values(TOPICS), behavior: "answer", minimumCitations: 3 } },
    { id: `${company.id}:future-refusal`, title: `${company.name} unsupported future question`, category: "insufficiency", question: `What did ${company.name} report after January 1, 2099?`, filters: { ...base, topic: "All topics", dateFrom: "2099-01-01" }, expectations: { topics: [], behavior: "insufficient", minimumCitations: 0 } },
  ];
}

function comparisonBenchmarks(): ResearchQualityBenchmark[] {
  const results: ResearchQualityBenchmark[] = [];
  for (let left = 0; left < TRACKED_COMPANIES.length; left += 1) {
    for (let right = left + 1; right < TRACKED_COMPANIES.length; right += 1) {
      const companyA = TRACKED_COMPANIES[left];
      const companyB = TRACKED_COMPANIES[right];
      results.push({
        id: `${companyA.id}:vs:${companyB.id}:capacity`,
        title: `${companyA.name} vs. ${companyB.name}`,
        category: "comparison",
        question: `Compare ${companyA.name} and ${companyB.name} using only disclosed power and capacity evidence.`,
        filters: { companyIds: [companyA.id, companyB.id], topic: TOPICS.capacity, sourceKinds: [] },
        expectations: { topics: [TOPICS.capacity], behavior: "answer", minimumCitations: 2 },
      });
    }
  }
  return results;
}

export const RESEARCH_QUALITY_BENCHMARKS: ResearchQualityBenchmark[] = [
  ...TRACKED_COMPANIES.flatMap(companyBenchmarks),
  ...comparisonBenchmarks(),
  {
    id: "neoclouds:cross-company-synthesis",
    title: "Four-company evidence synthesis",
    category: "synthesis",
    question: "Compare all covered Neoclouds on capacity, demand, and financing using only accepted evidence.",
    filters: { companyIds: TRACKED_COMPANIES.map((item) => item.id), topic: "All topics", sourceKinds: [] },
    expectations: { topics: Object.values(TOPICS), behavior: "answer", minimumCitations: 12 },
  },
  {
    id: "neoclouds:unsupported-future",
    title: "Cross-company unsupported future question",
    category: "insufficiency",
    question: "Which Neocloud reported the strongest results after January 1, 2099?",
    filters: { companyIds: TRACKED_COMPANIES.map((item) => item.id), topic: "All topics", sourceKinds: [], dateFrom: "2099-01-01" },
    expectations: { topics: [], behavior: "insufficient", minimumCitations: 0 },
  },
];

function percentage(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 100) : 100;
}

export function scoreResearchQualityCase(input: {
  benchmark: ResearchQualityBenchmark;
  evidence: ResearchEvidenceItem[];
  claims: ResearchAssistantClaim[];
  rawClaimCount: number;
  rejectedClaims: number;
}) {
  const { benchmark, evidence, claims, rawClaimCount, rejectedClaims } = input;
  const expectedCompanies = benchmark.filters.companyIds;
  const expectedCells = expectedCompanies.flatMap((companyId) => benchmark.expectations.topics.map((topic) => `${companyId}:${topic}`));
  const foundCells = new Set(evidence.map((item) => `${item.companyId}:${item.topic}`));
  const retrievalCoverage = percentage(expectedCells.filter((cell) => foundCells.has(cell)).length, expectedCells.length);
  const citationIds = [...new Set(claims.flatMap((claim) => claim.citationIds))];
  const citationPrecision = percentage(rawClaimCount - rejectedClaims, rawClaimCount);
  const groundedness = percentage(rawClaimCount - rejectedClaims, rawClaimCount);
  const companiesWithClaims = new Set(claims.map((claim) => claim.companyId));
  const companyAccuracy = benchmark.expectations.behavior === "insufficient"
    ? (claims.length === 0 ? 100 : 0)
    : percentage(expectedCompanies.filter((id) => companiesWithClaims.has(id)).length, expectedCompanies.length);
  const behaviorCorrect = benchmark.expectations.behavior === "insufficient" ? claims.length === 0 : claims.length > 0;
  const citationCompleteness = benchmark.expectations.minimumCitations
    ? Math.min(100, percentage(citationIds.length, benchmark.expectations.minimumCitations))
    : (citationIds.length === 0 ? 100 : 0);
  const answerCompleteness = behaviorCorrect ? Math.round((citationCompleteness + companyAccuracy) / 2) : 0;
  const overall = Math.round(retrievalCoverage * .30 + citationPrecision * .25 + groundedness * .20 + companyAccuracy * .15 + answerCompleteness * .10);
  const failureReasons: string[] = [];
  if (!behaviorCorrect) failureReasons.push(benchmark.expectations.behavior === "insufficient" ? "The answer should have refused because no eligible evidence was available." : "No supported answer claims were produced.");
  if (retrievalCoverage < 70) failureReasons.push(`Expected company-topic retrieval coverage was ${retrievalCoverage}%.`);
  if (citationPrecision < 100) failureReasons.push(`${rejectedClaims} generated claim${rejectedClaims === 1 ? " was" : "s were"} rejected by citation verification.`);
  if (companyAccuracy < 100) failureReasons.push("One or more expected companies had no supported claim.");
  if (citationIds.length < benchmark.expectations.minimumCitations) failureReasons.push(`Only ${citationIds.length} of ${benchmark.expectations.minimumCitations} expected citations were returned.`);
  const scores: ResearchQualityScores = { retrievalCoverage, citationPrecision, groundedness, companyAccuracy, answerCompleteness, overall };
  return { scores, failureReasons, status: overall >= 80 && failureReasons.length === 0 ? "passed" as const : "failed" as const, citationCount: citationIds.length };
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function estimatedCostMicros(usage: { inputTokens?: number; outputTokens?: number }) {
  const inputRate = Number(process.env.AI_QUALITY_INPUT_COST_PER_MILLION ?? 0);
  const outputRate = Number(process.env.AI_QUALITY_OUTPUT_COST_PER_MILLION ?? 0);
  return Math.round((usage.inputTokens ?? 0) * inputRate + (usage.outputTokens ?? 0) * outputRate);
}

export async function runResearchQualitySuite(engine: Exclude<ResearchAssistantEngine, "auto"> = "deterministic") {
  const id = `research-quality:${crypto.randomUUID()}`;
  const startedAt = performance.now();
  const inserted = await withDatabase((db) => db.insert(researchQualityRuns).values({ id, suiteVersion: RESEARCH_QUALITY_SUITE_VERSION, engine, caseCount: RESEARCH_QUALITY_BENCHMARKS.length }).returning());
  if (!inserted?.[0]) throw new Error("Postgres is required to run the research quality suite.");

  try {
    const results: ResearchQualityResult[] = [];
    for (const benchmark of RESEARCH_QUALITY_BENCHMARKS) {
      const pipeline = await runResearchAssistantPipeline(benchmark.question, benchmark.filters, engine);
      const scored = scoreResearchQualityCase({ benchmark, evidence: pipeline.selected, claims: pipeline.claims, rawClaimCount: pipeline.rawClaimCount, rejectedClaims: pipeline.verification.rejectedClaims });
      const result: ResearchQualityResult = {
        id: `research-quality-result:${crypto.randomUUID()}`,
        benchmarkId: benchmark.id,
        title: benchmark.title,
        category: benchmark.category,
        question: benchmark.question,
        companyIds: benchmark.filters.companyIds,
        expectations: benchmark.expectations,
        status: scored.status,
        scores: scored.scores,
        failureReasons: scored.failureReasons,
        citations: pipeline.selected,
        claims: pipeline.claims,
        retrievalMode: pipeline.retrievalMode,
        citationCount: scored.citationCount,
        unsupportedClaimCount: pipeline.verification.rejectedClaims,
        inputTokens: pipeline.usage.inputTokens ?? null,
        outputTokens: pipeline.usage.outputTokens ?? null,
        totalTokens: pipeline.usage.totalTokens ?? null,
        estimatedCostMicros: estimatedCostMicros(pipeline.usage),
        latencyMs: pipeline.latencyMs,
      };
      results.push(result);
      await withDatabase((db) => db.insert(researchQualityResults).values({
        id: result.id, runId: id, benchmarkId: result.benchmarkId, title: result.title, category: result.category,
        question: result.question, companyIds: result.companyIds, expectations: result.expectations, status: result.status,
        scores: result.scores, failureReasons: result.failureReasons, evidenceSnapshot: result.citations, claims: result.claims,
        retrievalMode: result.retrievalMode, citationCount: result.citationCount, unsupportedClaimCount: result.unsupportedClaimCount,
        inputTokens: result.inputTokens ?? undefined, outputTokens: result.outputTokens ?? undefined, totalTokens: result.totalTokens ?? undefined,
        estimatedCostMicros: result.estimatedCostMicros, latencyMs: result.latencyMs,
      }));
    }

    const metrics = {
      retrievalCoverage: average(results.map((item) => item.scores.retrievalCoverage)),
      citationPrecision: average(results.map((item) => item.scores.citationPrecision)),
      groundedness: average(results.map((item) => item.scores.groundedness)),
      companyAccuracy: average(results.map((item) => item.scores.companyAccuracy)),
      answerCompleteness: average(results.map((item) => item.scores.answerCompleteness)),
    };
    const passedCount = results.filter((item) => item.status === "passed").length;
    const overallScore = average(results.map((item) => item.scores.overall));
    const passRate = percentage(passedCount, results.length);
    const durationMs = Math.max(1, Math.round(performance.now() - startedAt));
    await withDatabase((db) => db.update(researchQualityRuns).set({ status: "completed", overallScore, passRate, metrics, passedCount, failedCount: results.length - passedCount, durationMs, completedAt: new Date() }).where(eq(researchQualityRuns.id, id)));
    return getResearchQualityRun(id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The research quality run failed.";
    await withDatabase((db) => db.update(researchQualityRuns).set({ status: "error", error: message, durationMs: Math.max(1, Math.round(performance.now() - startedAt)), completedAt: new Date() }).where(eq(researchQualityRuns.id, id)));
    throw error;
  }
}

function resultFromRow(row: typeof researchQualityResults.$inferSelect): ResearchQualityResult {
  return {
    id: row.id, benchmarkId: row.benchmarkId, title: row.title, category: row.category, question: row.question,
    companyIds: row.companyIds as string[], expectations: row.expectations as ResearchQualityResult["expectations"], status: row.status as ResearchQualityResult["status"],
    scores: row.scores as ResearchQualityScores, failureReasons: row.failureReasons as string[], citations: row.evidenceSnapshot as ResearchEvidenceItem[], claims: row.claims as ResearchAssistantClaim[],
    retrievalMode: row.retrievalMode, citationCount: row.citationCount, unsupportedClaimCount: row.unsupportedClaimCount,
    inputTokens: row.inputTokens, outputTokens: row.outputTokens, totalTokens: row.totalTokens, estimatedCostMicros: row.estimatedCostMicros, latencyMs: row.latencyMs,
  };
}

function runFromRow(row: typeof researchQualityRuns.$inferSelect, results: ResearchQualityResult[] = []): ResearchQualityRun {
  return {
    id: row.id, suiteVersion: row.suiteVersion, engine: row.engine, status: row.status as ResearchQualityRun["status"], overallScore: row.overallScore,
    passRate: row.passRate, metrics: row.metrics as ResearchQualityRun["metrics"], caseCount: row.caseCount, passedCount: row.passedCount,
    failedCount: row.failedCount, durationMs: row.durationMs, error: row.error, startedAt: row.startedAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, results,
  };
}

export async function listResearchQualityRuns() {
  const rows = await withDatabase((db) => db.select().from(researchQualityRuns).orderBy(desc(researchQualityRuns.createdAt)).limit(20));
  if (!rows) throw new Error("Postgres is required for research quality history.");
  return rows.map((row) => runFromRow(row));
}

export async function getResearchQualityRun(id: string) {
  const result = await withDatabase(async (db) => {
    const run = (await db.select().from(researchQualityRuns).where(eq(researchQualityRuns.id, id)).limit(1))[0];
    if (!run) return null;
    const rows = await db.select().from(researchQualityResults).where(eq(researchQualityResults.runId, id)).orderBy(asc(researchQualityResults.createdAt));
    return runFromRow(run, rows.map(resultFromRow));
  });
  if (!result) throw new Error("Research quality run not found.");
  return result;
}

export function researchQualityGate(run: ResearchQualityRun) {
  const metrics = run.metrics as Omit<ResearchQualityScores, "overall">;
  const reasons: string[] = [];
  if ((run.overallScore ?? 0) < 85) reasons.push(`Overall score ${(run.overallScore ?? 0)} is below 85.`);
  if ((run.passRate ?? 0) < 85) reasons.push(`Pass rate ${(run.passRate ?? 0)}% is below 85%.`);
  if ((metrics.citationPrecision ?? 0) < 100) reasons.push("Citation precision must remain at 100%.");
  if ((metrics.groundedness ?? 0) < 100) reasons.push("Groundedness must remain at 100%.");
  return { passed: reasons.length === 0, reasons };
}
