import { researchQualityGate, runResearchQualitySuite } from "@/lib/research/research-quality";

const useAi = process.argv.includes("--ai");
const gateEnabled = process.argv.includes("--gate");
const run = await runResearchQualitySuite(useAi ? "ai" : "deterministic");
const gate = researchQualityGate(run);

console.log(`Research quality ${run.id}`);
console.log(`Suite: ${run.suiteVersion} (${run.caseCount} cases)`);
console.log(`Overall: ${run.overallScore}/100 | Pass rate: ${run.passRate}% | ${run.passedCount} passed, ${run.failedCount} failed`);
console.log(`Retrieval: ${run.metrics.retrievalCoverage}% | Citations: ${run.metrics.citationPrecision}% | Groundedness: ${run.metrics.groundedness}%`);

if (gateEnabled && !gate.passed) {
  for (const reason of gate.reasons) console.error(`Quality gate: ${reason}`);
  process.exitCode = 1;
}
