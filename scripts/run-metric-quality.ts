import type { AuthContext } from "@/lib/auth/types";
import { ensureDemoIdentity } from "@/lib/auth/session";
import { metricQualityGate, runMetricQualitySuite } from "@/lib/company-intelligence/metric-quality";

const identity = await ensureDemoIdentity();
const workspace = { id: identity.workspaceId, name: "Neocloud Research", slug: "neocloud-research", role: "admin" as const };
const auth: AuthContext = {
  sessionId: "metric-quality-cli",
  user: { id: identity.userId, email: "demo@ai-infra.local", name: "Demo Analyst", avatarUrl: null },
  workspace,
  workspaces: [workspace],
};
const run = await runMetricQualitySuite(auth);
const gate = metricQualityGate(run);

console.log(`Metric quality ${run.id}`);
console.log(`Suite: ${run.suiteVersion} (${run.caseCount} cases)`);
console.log(`Overall: ${run.overallScore}/100 | Pass rate: ${run.passRate}% | ${run.passedCount} passed, ${run.failedCount} failed`);
console.log(`Classification: ${run.metrics.classificationAccuracy}% | Values: ${run.metrics.valueAccuracy}% | Anomaly safety: ${run.metrics.anomalySafety}% | Live contracts: ${run.metrics.contractHealth}%`);

if (process.argv.includes("--gate") && !gate.passed) {
  for (const reason of gate.reasons) console.error(`Metric quality gate: ${reason}`);
  process.exitCode = 1;
}
