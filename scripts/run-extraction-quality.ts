import type { AuthContext } from "@/lib/auth/types";
import { ensureDemoIdentity } from "@/lib/auth/session";
import { extractionQualityGate, runExtractionQualitySuite } from "@/lib/extraction-quality/service";

const identity = await ensureDemoIdentity();
const workspace = { id: identity.workspaceId, name: "Neocloud Research", slug: "neocloud-research", role: "admin" as const };
const auth: AuthContext = {
  sessionId: "extraction-quality-cli",
  user: { id: identity.userId, email: "demo@ai-infra.local", name: "Demo Analyst", avatarUrl: null },
  workspace,
  workspaces: [workspace],
};
const run = await runExtractionQualitySuite(auth);
const gate = extractionQualityGate(run);

console.log(`Source extraction quality ${run.id}`);
console.log(`Suite: ${run.suiteVersion} (${run.caseCount} immutable source cases)`);
console.log(`Parser: ${run.parserVersion}`);
console.log(`Overall: ${run.overallScore}/100 | Pass rate: ${run.passRate}% | ${run.passedCount} passed, ${run.failedCount} failed`);
console.log(`Metric recall: ${run.metrics.metricRecall}% | Precision: ${run.metrics.metricPrecision}% | False-positive safety: ${run.metrics.forbiddenSafety}% | Period accuracy: ${run.metrics.periodAccuracy}%`);

if (process.argv.includes("--gate") && !gate.passed) {
  for (const reason of gate.reasons) console.error(`Source extraction gate: ${reason}`);
  process.exitCode = 1;
}
