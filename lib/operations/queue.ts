import { Queue, type ConnectionOptions } from "bullmq";
import { and, desc, eq, inArray } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { researchCycleEvents, researchCycleRuns } from "@/lib/db/schema";
import {
  createTraceId,
  cycleJobId,
  RESEARCH_CYCLE_QUEUE,
  RESEARCH_DEAD_LETTER_QUEUE,
  RESEARCH_STAGE_QUEUE,
} from "@/lib/operations/queue-contracts";
import { RESEARCH_STAGE_NAMES, type ResearchCycleJobData, type ResearchStageName } from "@/lib/operations/types";

const ACTIVE_RUN_STATUSES = ["queued", "running", "cancelling"];

export function redisUrl() {
  if (process.env.E2E_TEST === "1" && process.env.E2E_REDIS_URL?.trim()) return process.env.E2E_REDIS_URL.trim();
  return process.env.REDIS_URL?.trim() || "redis://127.0.0.1:6379";
}

export function redisConnectionOptions(worker = false): ConnectionOptions {
  const url = new URL(redisUrl());
  const configuredDatabase = Number(url.pathname.replace(/^\//, "") || "0");
  const database = process.env.E2E_TEST === "1" ? 1 : configuredDatabase;
  return {
    host: url.hostname,
    port: Number(url.port || "6379"),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: Number.isFinite(database) ? database : 0,
    tls: url.protocol === "rediss:" ? {} : undefined,
    connectTimeout: 1_500,
    maxRetriesPerRequest: worker ? null : 1,
  };
}

function queue(name: string) {
  return new Queue(name, { connection: redisConnectionOptions() });
}

async function closeQueues(queues: Queue[]) {
  await Promise.allSettled(queues.map((item) => item.close()));
}

export async function getResearchQueueStatus() {
  const cycleQueue = queue(RESEARCH_CYCLE_QUEUE);
  const stageQueue = queue(RESEARCH_STAGE_QUEUE);
  const deadLetterQueue = queue(RESEARCH_DEAD_LETTER_QUEUE);
  try {
    const [cycleCounts, stageCounts, deadLetterCounts] = await Promise.all([
      cycleQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
      stageQueue.getJobCounts("waiting", "active", "delayed", "failed", "completed"),
      deadLetterQueue.getJobCounts("waiting"),
    ]);
    return {
      available: true,
      waiting: cycleCounts.waiting + stageCounts.waiting,
      active: cycleCounts.active + stageCounts.active,
      delayed: cycleCounts.delayed + stageCounts.delayed,
      failed: cycleCounts.failed + stageCounts.failed,
      completed: cycleCounts.completed + stageCounts.completed,
      deadLetters: deadLetterCounts.waiting,
      error: null,
    };
  } catch (error) {
    return {
      available: false,
      waiting: 0,
      active: 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      deadLetters: 0,
      error: error instanceof Error ? error.message : "Redis is unavailable.",
    };
  } finally {
    await closeQueues([cycleQueue, stageQueue, deadLetterQueue]);
  }
}

type EnqueueOptions = {
  trigger: string;
  requestedByUserId?: string | null;
  retryOfRunId?: string | null;
  allowConcurrent?: boolean;
};

export async function enqueueResearchCycle(options: EnqueueOptions) {
  const context = await withDatabase(async (db) => {
    if (!options.allowConcurrent) {
      const active = (await db.select().from(researchCycleRuns)
        .where(inArray(researchCycleRuns.status, ACTIVE_RUN_STATUSES))
        .orderBy(desc(researchCycleRuns.createdAt)).limit(1))[0];
      if (active) return { existing: active } as const;
    }
    const previous = (await db.select().from(researchCycleRuns)
      .where(eq(researchCycleRuns.status, "completed"))
      .orderBy(desc(researchCycleRuns.completedAt)).limit(1))[0];
    const runId = `cycle:${crypto.randomUUID()}`;
    const traceId = createTraceId();
    const windowStartedAt = (previous?.completedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1_000)).toISOString();
    const stored = (await db.insert(researchCycleRuns).values({
      id: runId,
      trigger: options.trigger,
      status: "queued",
      stage: "queued",
      traceId,
      requestedByUserId: options.requestedByUserId ?? null,
      retryOfRunId: options.retryOfRunId ?? null,
      context: { windowStartedAt },
      progress: 0,
    }).returning())[0];
    return { stored, windowStartedAt } as const;
  });
  if (!context) throw new Error("Postgres is required to enqueue a research cycle.");
  if ("existing" in context) return { ...context.existing, deduplicated: true };

  const cycleQueue = queue(RESEARCH_CYCLE_QUEUE);
  const data: ResearchCycleJobData = {
    runId: context.stored.id,
    trigger: context.stored.trigger,
    traceId: context.stored.traceId!,
    windowStartedAt: context.windowStartedAt,
  };
  try {
    const job = await cycleQueue.add("run-research-cycle", data, {
      jobId: cycleJobId(context.stored.id),
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    });
    await withDatabase((db) => db.update(researchCycleRuns).set({ queueJobId: job.id }).where(eq(researchCycleRuns.id, context.stored.id)));
    return { ...context.stored, queueJobId: job.id, deduplicated: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to enqueue the research cycle.";
    await withDatabase((db) => db.update(researchCycleRuns).set({ status: "failed", stage: "queue-failed", error: message, completedAt: new Date() }).where(eq(researchCycleRuns.id, context.stored.id)));
    throw new Error(`Redis queue unavailable: ${message}`);
  } finally {
    await cycleQueue.close();
  }
}

async function runForControl(runId: string) {
  const run = await withDatabase(async (db) => (await db.select().from(researchCycleRuns).where(eq(researchCycleRuns.id, runId)).limit(1))[0] ?? null);
  if (!run) throw new Error("Research cycle not found.");
  return run;
}

export async function cancelResearchCycle(runId: string) {
  const run = await runForControl(runId);
  if (["completed", "failed", "cancelled"].includes(run.status)) throw new Error("This research cycle is already finished.");
  const now = new Date();
  const cycleQueue = queue(RESEARCH_CYCLE_QUEUE);
  try {
    const job = run.queueJobId ? await cycleQueue.getJob(run.queueJobId) : null;
    const state = job ? await job.getState() : "unknown";
    if (job && ["waiting", "delayed", "paused"].includes(state)) {
      await job.remove();
      await withDatabase((db) => db.update(researchCycleRuns).set({ status: "cancelled", stage: "cancelled", cancelRequestedAt: now, completedAt: now }).where(eq(researchCycleRuns.id, runId)));
      return { status: "cancelled" as const };
    }
    await withDatabase((db) => db.update(researchCycleRuns).set({ status: "cancelling", cancelRequestedAt: now }).where(eq(researchCycleRuns.id, runId)));
    return { status: "cancelling" as const };
  } finally {
    await cycleQueue.close();
  }
}

export async function retryResearchStage(runId: string, stage: ResearchStageName) {
  if (!RESEARCH_STAGE_NAMES.includes(stage)) throw new Error("Choose a valid failed pipeline stage.");
  const run = await runForControl(runId);
  const failedEvent = await withDatabase(async (db) => (await db.select().from(researchCycleEvents).where(and(
    eq(researchCycleEvents.runId, runId),
    eq(researchCycleEvents.stage, stage),
    inArray(researchCycleEvents.status, ["failed", "retrying"]),
  )).orderBy(desc(researchCycleEvents.startedAt)).limit(1))[0] ?? null);
  if (!failedEvent) throw new Error("That stage does not have a failed attempt to retry.");
  const context = run.context as { windowStartedAt?: string };
  const data: ResearchCycleJobData = {
    runId,
    trigger: `retry:${stage}`,
    traceId: run.traceId || createTraceId(),
    windowStartedAt: context.windowStartedAt || new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString(),
  };
  const cycleQueue = queue(RESEARCH_CYCLE_QUEUE);
  try {
    const generation = `resume-${Date.now()}`;
    const job = await cycleQueue.add("resume-research-cycle", data, {
      jobId: cycleJobId(runId, generation),
      attempts: 1,
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 500 },
    });
    await withDatabase((db) => db.update(researchCycleRuns).set({ status: "queued", stage: `retrying-${stage}`, queueJobId: job.id, error: null, cancelRequestedAt: null, completedAt: null }).where(eq(researchCycleRuns.id, runId)));
    return { id: runId, status: "queued" as const, queueJobId: job.id };
  } finally {
    await cycleQueue.close();
  }
}

export async function replayResearchCycle(runId: string, requestedByUserId?: string | null) {
  await runForControl(runId);
  return enqueueResearchCycle({ trigger: `replay:${runId}`, requestedByUserId, retryOfRunId: runId, allowConcurrent: true });
}
