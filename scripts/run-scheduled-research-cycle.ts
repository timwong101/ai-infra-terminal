import { assertArtifactStorageReady } from "@/lib/artifacts/storage";
import { runDirectResearchCycle } from "@/lib/operations/direct-cycle";
import { startOperationTelemetry, stopOperationTelemetry } from "@/lib/operations/telemetry";

assertArtifactStorageReady({ durable: true });
await startOperationTelemetry("ai-infra-scheduled-research");
try {
  const result = await runDirectResearchCycle("github-actions");
  console.log(`Scheduled research cycle ${result.id} completed.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await stopOperationTelemetry();
}
