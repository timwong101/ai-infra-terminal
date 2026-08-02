import type { ResearchQualityRun } from "@/lib/research/types";

export const RESEARCH_QUALITY_GATES = {
  overall: 85,
  passRate: 85,
  citationPrecision: 100,
  groundedness: 100,
} as const;

const CRITICAL_QUALITY_CATEGORIES = new Set(["source-policy", "insufficiency", "production-regression"]);

export function researchQualityGate(run: ResearchQualityRun) {
  const metrics = run.metrics;
  const reasons: string[] = [];
  if ((run.overallScore ?? 0) < RESEARCH_QUALITY_GATES.overall) reasons.push(`Overall score ${run.overallScore ?? 0} is below ${RESEARCH_QUALITY_GATES.overall}.`);
  if ((run.passRate ?? 0) < RESEARCH_QUALITY_GATES.passRate) reasons.push(`Pass rate ${run.passRate ?? 0}% is below ${RESEARCH_QUALITY_GATES.passRate}%.`);
  if ((metrics.citationPrecision ?? 0) < RESEARCH_QUALITY_GATES.citationPrecision) reasons.push(`Citation precision must remain at ${RESEARCH_QUALITY_GATES.citationPrecision}%.`);
  if ((metrics.groundedness ?? 0) < RESEARCH_QUALITY_GATES.groundedness) reasons.push(`Groundedness must remain at ${RESEARCH_QUALITY_GATES.groundedness}%.`);
  const criticalFailures = (run.results ?? []).filter((result) => result.status === "failed" && CRITICAL_QUALITY_CATEGORIES.has(result.category));
  if (criticalFailures.length) reasons.push(`Critical benchmark failures: ${criticalFailures.map((result) => result.title).join(", ")}.`);
  return { passed: reasons.length === 0, reasons };
}
