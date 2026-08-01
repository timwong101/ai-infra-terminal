import { runResearchCycle } from "@/lib/operations/research-cycle";
import { startOperationTelemetry, stopOperationTelemetry } from "@/lib/operations/telemetry";
import { startResearchWorkers } from "@/lib/operations/worker";
import { assertArtifactStorageReady } from "@/lib/artifacts/storage";

assertArtifactStorageReady({ durable: process.env.GITHUB_ACTIONS === "true" || process.env.ARTIFACT_STORAGE_REQUIRED === "1" });
await startOperationTelemetry("ai-infra-research-cli");
const runtime = startResearchWorkers({ workerId: `research-cli:${process.pid}` });

try {
  await runtime.ready;
  const result = await runResearchCycle(process.env.GITHUB_ACTIONS ? "github-actions" : "cli");
  console.log(`Research cycle ${result.id} completed.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await runtime.close();
  await stopOperationTelemetry();
}
