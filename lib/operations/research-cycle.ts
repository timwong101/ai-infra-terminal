import { desc, eq, inArray } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { getIrIngestionSummary } from "@/lib/db/ir-evidence-repository";
import { researchCycleEvents, researchCycleRuns, researchWorkers } from "@/lib/db/schema";
import { listResearchBriefings } from "@/lib/operations/briefing";
import { getCompanyFlowCoverage } from "@/lib/operations/company-coverage";
import { enqueueResearchCycle, getResearchQueueStatus } from "@/lib/operations/queue";
import type { ResearchCycleEventItem, ResearchCycleRunItem, ResearchRuntimeSnapshot, ResearchWorkerItem } from "@/lib/operations/types";
import { getArtifactIntegritySummary } from "@/lib/artifacts/service";

function runItem(run: typeof researchCycleRuns.$inferSelect): ResearchCycleRunItem {
  return {
    id: run.id,
    trigger: run.trigger,
    status: run.status,
    stage: run.stage,
    queueJobId: run.queueJobId,
    traceId: run.traceId,
    workerId: run.workerId,
    retryOfRunId: run.retryOfRunId,
    progress: run.progress,
    metrics: run.metrics as Record<string, unknown>,
    error: run.error,
    cancelRequestedAt: run.cancelRequestedAt?.toISOString() ?? null,
    lastHeartbeatAt: run.lastHeartbeatAt?.toISOString() ?? null,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    createdAt: run.createdAt.toISOString(),
  };
}

function eventItem(event: typeof researchCycleEvents.$inferSelect): ResearchCycleEventItem {
  return {
    id: event.id,
    runId: event.runId,
    stage: event.stage,
    status: event.status,
    attempt: event.attempt,
    jobId: event.jobId,
    maxAttempts: event.maxAttempts,
    message: event.message,
    metrics: event.metrics as Record<string, unknown>,
    nextRetryAt: event.nextRetryAt?.toISOString() ?? null,
    startedAt: event.startedAt.toISOString(),
    completedAt: event.completedAt?.toISOString() ?? null,
  };
}

function workerItem(worker: typeof researchWorkers.$inferSelect): ResearchWorkerItem {
  const online = worker.status === "online" && Date.now() - worker.lastHeartbeatAt.valueOf() < 20_000;
  return {
    id: worker.id,
    queueName: worker.queueName,
    status: online ? "online" : "offline",
    currentRunId: worker.currentRunId,
    concurrency: worker.concurrency,
    metadata: worker.metadata as Record<string, unknown>,
    startedAt: worker.startedAt.toISOString(),
    lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(),
    online,
  };
}

export async function getResearchRuntimeSnapshot(): Promise<ResearchRuntimeSnapshot> {
  const stored = await withDatabase(async (db) => {
    const runs = await db.select().from(researchCycleRuns).orderBy(desc(researchCycleRuns.createdAt)).limit(20);
    const runIds = runs.map((run) => run.id);
    const events = runIds.length
      ? await db.select().from(researchCycleEvents).where(inArray(researchCycleEvents.runId, runIds)).orderBy(desc(researchCycleEvents.startedAt))
      : [];
    const workers = await db.select().from(researchWorkers).orderBy(desc(researchWorkers.lastHeartbeatAt)).limit(20);
    return { runs, events, workers };
  });
  if (!stored) throw new Error("Research operations require a configured database.");
  return {
    runs: stored.runs.map(runItem),
    events: stored.events.map(eventItem),
    workers: stored.workers.map(workerItem),
    queue: await getResearchQueueStatus(),
    generatedAt: new Date().toISOString(),
  };
}

export async function getResearchOperations(workspaceId: string) {
  const [runtime, briefings, ingestion, coverage, artifactIntegrity] = await Promise.all([
    getResearchRuntimeSnapshot(),
    listResearchBriefings(12),
    getIrIngestionSummary(),
    getCompanyFlowCoverage(workspaceId),
    getArtifactIntegritySummary(),
  ]);
  return {
    ...runtime,
    briefings,
    ingestion,
    coverage,
    artifactIntegrity,
    schedule: {
      cadence: "Every 6 hours",
      cron: "17 */6 * * *",
      source: "BullMQ worker · GitHub Actions trigger",
      nextAction: runtime.queue.available ? "Queue connected" : "Start Redis and the research worker",
    },
    aiEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
  };
}

export async function waitForResearchCycle(runId: string, timeoutMs = 20 * 60 * 1_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const run = await withDatabase(async (db) => (await db.select().from(researchCycleRuns).where(eq(researchCycleRuns.id, runId)).limit(1))[0] ?? null);
    if (!run) throw new Error("Queued research cycle disappeared.");
    if (run.status === "completed") return runItem(run);
    if (run.status === "failed" || run.status === "cancelled") throw new Error(run.error || `Research cycle ${run.status}.`);
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Research cycle timed out while waiting for its worker.");
}

export async function runResearchCycle(trigger = "manual") {
  const run = await enqueueResearchCycle({ trigger, allowConcurrent: true });
  if (!run.id) throw new Error("Queued research cycle did not return an ID.");
  return waitForResearchCycle(run.id);
}
