import { Job, Queue, QueueEvents, Worker } from "bullmq";
import { and, desc, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { researchCycleEvents, researchCycleRuns, researchWorkers } from "@/lib/db/schema";
import {
  RESEARCH_CYCLE_QUEUE,
  RESEARCH_DEAD_LETTER_QUEUE,
  RESEARCH_STAGE_ATTEMPTS,
  RESEARCH_STAGE_BACKOFF_MS,
  RESEARCH_STAGE_GROUPS,
  RESEARCH_STAGE_QUEUE,
  retryDelay,
  stageEventId,
  stageJobId,
  stageProgress,
} from "@/lib/operations/queue-contracts";
import { redisConnectionOptions } from "@/lib/operations/queue";
import { executeResearchStage } from "@/lib/operations/stages";
import { withOperationSpan } from "@/lib/operations/telemetry";
import type { ResearchCycleJobData, ResearchStageJobData, ResearchStageName } from "@/lib/operations/types";

class ResearchCycleCancelledError extends Error {
  constructor() { super("Research cycle cancellation was requested."); }
}

async function currentRun(runId: string) {
  const run = await withDatabase(async (db) => (await db.select().from(researchCycleRuns).where(eq(researchCycleRuns.id, runId)).limit(1))[0] ?? null);
  if (!run) throw new Error(`Research cycle ${runId} is unavailable.`);
  return run;
}

async function ensureNotCancelled(runId: string) {
  const run = await currentRun(runId);
  if (run.cancelRequestedAt || run.status === "cancelling" || run.status === "cancelled") throw new ResearchCycleCancelledError();
}

async function completedStageCount(runId: string) {
  const events = await withDatabase((db) => db.select({ stage: researchCycleEvents.stage }).from(researchCycleEvents).where(and(
    eq(researchCycleEvents.runId, runId),
    eq(researchCycleEvents.status, "completed"),
  )));
  return new Set((events ?? []).map((event) => event.stage)).size;
}

async function completedStage(runId: string, stage: ResearchStageName) {
  return withDatabase(async (db) => (await db.select().from(researchCycleEvents).where(and(
    eq(researchCycleEvents.runId, runId),
    eq(researchCycleEvents.stage, stage),
    eq(researchCycleEvents.status, "completed"),
  )).orderBy(desc(researchCycleEvents.completedAt)).limit(1))[0] ?? null);
}

async function runStageJob(
  cycleJob: Job<ResearchCycleJobData>,
  stage: ResearchStageName,
  stageQueue: Queue<ResearchStageJobData>,
  stageEvents: QueueEvents,
) {
  const existing = await completedStage(cycleJob.data.runId, stage);
  if (existing) return existing.metrics as Record<string, unknown>;
  await ensureNotCancelled(cycleJob.data.runId);
  const data: ResearchStageJobData = { ...cycleJob.data, stage };
  const generation = cycleJob.id || `cycle-${Date.now()}`;
  const job = await stageQueue.add(stage, data, {
    jobId: stageJobId(data.runId, stage, generation),
    attempts: RESEARCH_STAGE_ATTEMPTS,
    backoff: { type: "exponential", delay: RESEARCH_STAGE_BACKOFF_MS },
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 1_000 },
  });
  return job.waitUntilFinished(stageEvents, 12 * 60 * 1_000) as Promise<Record<string, unknown>>;
}

async function recordWorker(workerId: string, queueName: string, concurrency: number, status: string, currentRunId: string | null) {
  const now = new Date();
  await withDatabase((db) => db.insert(researchWorkers).values({
    id: workerId,
    queueName,
    status,
    currentRunId,
    concurrency,
    metadata: { pid: process.pid, node: process.version, platform: process.platform },
    startedAt: now,
    lastHeartbeatAt: now,
  }).onConflictDoUpdate({
    target: researchWorkers.id,
    set: { queueName, status, currentRunId, concurrency, metadata: { pid: process.pid, node: process.version, platform: process.platform }, lastHeartbeatAt: now },
  }));
}

export type ResearchWorkerRuntime = {
  workerId: string;
  ready: Promise<void>;
  health: () => { workerId: string; ready: boolean; currentRunId: string | null };
  close: () => Promise<void>;
};

export function startResearchWorkers(options: { workerId?: string; cycleConcurrency?: number; stageConcurrency?: number } = {}): ResearchWorkerRuntime {
  const baseWorkerId = options.workerId || `research-worker:${process.pid}:${crypto.randomUUID().slice(0, 8)}`;
  const cycleWorkerId = `${baseWorkerId}:cycle`;
  const stageWorkerId = `${baseWorkerId}:stage`;
  const cycleConcurrency = options.cycleConcurrency ?? 1;
  const stageConcurrency = options.stageConcurrency ?? 3;
  const connection = redisConnectionOptions(true);
  const stageQueue = new Queue<ResearchStageJobData>(RESEARCH_STAGE_QUEUE, { connection });
  const deadLetterQueue = new Queue<ResearchStageJobData>(RESEARCH_DEAD_LETTER_QUEUE, { connection });
  const stageEvents = new QueueEvents(RESEARCH_STAGE_QUEUE, { connection });
  let readyState = false;
  let currentRunId: string | null = null;

  const stageWorker = new Worker<ResearchStageJobData, Record<string, unknown>>(RESEARCH_STAGE_QUEUE, async (job) => {
    const attempt = job.attemptsMade + 1;
    const maxAttempts = Number(job.opts.attempts || RESEARCH_STAGE_ATTEMPTS);
    const eventId = stageEventId(job.id!, attempt);
    const startedAt = new Date();
    await withDatabase(async (db) => {
      await db.update(researchCycleRuns).set({ stage: job.data.stage, lastHeartbeatAt: startedAt }).where(eq(researchCycleRuns.id, job.data.runId));
      await db.insert(researchCycleEvents).values({
        id: eventId,
        runId: job.data.runId,
        stage: job.data.stage,
        status: "running",
        attempt,
        jobId: job.id,
        maxAttempts,
        startedAt,
      }).onConflictDoUpdate({
        target: researchCycleEvents.id,
        set: { status: "running", message: null, nextRetryAt: null, startedAt, completedAt: null },
      });
    });
    try {
      await ensureNotCancelled(job.data.runId);
      const metrics = await withOperationSpan(`research.stage.${job.data.stage}`, {
        "research.run.id": job.data.runId,
        "research.stage": job.data.stage,
        "research.trace.id": job.data.traceId,
        "research.attempt": attempt,
      }, () => executeResearchStage(job.data.stage, job.data));
      const durationMs = Date.now() - startedAt.valueOf();
      await withDatabase((db) => db.update(researchCycleEvents).set({ status: "completed", metrics: { durationMs, ...metrics }, completedAt: new Date(), nextRetryAt: null }).where(eq(researchCycleEvents.id, eventId)));
      const count = await completedStageCount(job.data.runId);
      await withDatabase((db) => db.update(researchCycleRuns).set({ progress: stageProgress(count), lastHeartbeatAt: new Date() }).where(eq(researchCycleRuns.id, job.data.runId)));
      await job.updateProgress(100);
      return { durationMs, ...metrics };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown stage error";
      const willRetry = attempt < maxAttempts && !(error instanceof ResearchCycleCancelledError);
      const nextRetryAt = willRetry ? new Date(Date.now() + retryDelay(attempt)) : null;
      await withDatabase((db) => db.update(researchCycleEvents).set({
        status: willRetry ? "retrying" : "failed",
        message,
        metrics: { durationMs: Date.now() - startedAt.valueOf() },
        nextRetryAt,
        completedAt: new Date(),
      }).where(eq(researchCycleEvents.id, eventId)));
      throw error;
    }
  }, { connection, concurrency: stageConcurrency, lockDuration: 120_000 });

  const cycleWorker = new Worker<ResearchCycleJobData, Record<string, unknown>>(RESEARCH_CYCLE_QUEUE, async (job) => {
    currentRunId = job.data.runId;
    const now = new Date();
    await withDatabase((db) => db.update(researchCycleRuns).set({
      status: "running",
      stage: "starting",
      workerId: cycleWorkerId,
      lastHeartbeatAt: now,
      error: null,
      completedAt: null,
    }).where(eq(researchCycleRuns.id, job.data.runId)));
    const metrics: Record<string, unknown> = {};
    try {
      await withOperationSpan("research.cycle", {
        "research.run.id": job.data.runId,
        "research.trace.id": job.data.traceId,
        "research.trigger": job.data.trigger,
      }, async () => {
        for (const group of RESEARCH_STAGE_GROUPS) {
          await ensureNotCancelled(job.data.runId);
          const results = await Promise.all(group.map(async (stage) => [stage, await runStageJob(job, stage, stageQueue, stageEvents)] as const));
          for (const [stage, result] of results) metrics[stage] = result;
          await job.updateProgress(stageProgress(await completedStageCount(job.data.runId)));
        }
      });
      await withDatabase((db) => db.update(researchCycleRuns).set({ status: "completed", stage: "completed", progress: 100, metrics, completedAt: new Date(), lastHeartbeatAt: new Date() }).where(eq(researchCycleRuns.id, job.data.runId)));
      return metrics;
    } catch (error) {
      if (error instanceof ResearchCycleCancelledError) {
        await withDatabase((db) => db.update(researchCycleRuns).set({ status: "cancelled", stage: "cancelled", metrics, completedAt: new Date(), lastHeartbeatAt: new Date() }).where(eq(researchCycleRuns.id, job.data.runId)));
        return { ...metrics, cancelled: true };
      }
      const message = error instanceof Error ? error.message : "Unknown research-cycle error";
      await withDatabase((db) => db.update(researchCycleRuns).set({ status: "failed", stage: "failed", error: message, metrics, completedAt: new Date(), lastHeartbeatAt: new Date() }).where(eq(researchCycleRuns.id, job.data.runId)));
      throw error;
    } finally {
      currentRunId = null;
    }
  }, { connection, concurrency: cycleConcurrency, lockDuration: 180_000 });

  const reportRuntimeError = (component: string, error: Error) => {
    console.error(`[research-worker:${component}] ${error.message}`);
  };
  cycleWorker.on("error", (error) => reportRuntimeError("cycle", error));
  stageWorker.on("error", (error) => reportRuntimeError("stage", error));
  stageEvents.on("error", (error) => reportRuntimeError("events", error));
  stageQueue.on("error", (error) => reportRuntimeError("stage-queue", error));
  deadLetterQueue.on("error", (error) => reportRuntimeError("dead-letter", error));

  stageWorker.on("failed", (job, error) => {
    if (!job || job.attemptsMade < Number(job.opts.attempts || RESEARCH_STAGE_ATTEMPTS)) return;
    void deadLetterQueue.add("failed-research-stage", {
      ...job.data,
      failedJobId: job.id,
      attemptsMade: job.attemptsMade,
      error: error.message,
      failedAt: new Date().toISOString(),
    } as ResearchStageJobData, { removeOnComplete: false, removeOnFail: false }).catch(() => undefined);
  });

  const heartbeat = async () => {
    await Promise.all([
      recordWorker(cycleWorkerId, RESEARCH_CYCLE_QUEUE, cycleConcurrency, "online", currentRunId),
      recordWorker(stageWorkerId, RESEARCH_STAGE_QUEUE, stageConcurrency, "online", currentRunId),
      currentRunId ? withDatabase((db) => db.update(researchCycleRuns).set({ lastHeartbeatAt: new Date() }).where(eq(researchCycleRuns.id, currentRunId!))) : Promise.resolve(null),
    ]);
  };

  const ready = Promise.all([cycleWorker.waitUntilReady(), stageWorker.waitUntilReady(), stageEvents.waitUntilReady()])
    .then(async () => {
      readyState = true;
      // Playwright starts the worker before it migrates its dedicated database.
      // Redis readiness should not be blocked by that first best-effort heartbeat.
      await heartbeat().catch(() => undefined);
    });
  const heartbeatTimer = setInterval(() => void heartbeat().catch(() => undefined), 5_000);

  return {
    workerId: baseWorkerId,
    ready,
    health: () => ({ workerId: baseWorkerId, ready: readyState, currentRunId }),
    close: async () => {
      clearInterval(heartbeatTimer);
      readyState = false;
      await Promise.allSettled([
        recordWorker(cycleWorkerId, RESEARCH_CYCLE_QUEUE, cycleConcurrency, "offline", null),
        recordWorker(stageWorkerId, RESEARCH_STAGE_QUEUE, stageConcurrency, "offline", null),
      ]);
      await Promise.allSettled([cycleWorker.close(), stageWorker.close(), stageEvents.close(), stageQueue.close(), deadLetterQueue.close()]);
    },
  };
}
