import { eq } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { researchCycleEvents, researchCycleRuns } from "@/lib/db/schema";
import { createCorrelationId, RESEARCH_STAGE_GROUPS, stageProgress } from "@/lib/operations/queue-contracts";
import { executeResearchStage } from "@/lib/operations/stages";
import type { ResearchCycleJobData, ResearchStageName } from "@/lib/operations/types";

async function runStage(data: ResearchCycleJobData, stage: ResearchStageName) {
  const eventId = `cycle-event:direct:${crypto.randomUUID()}`;
  const startedAt = new Date();
  await withDatabase((db) => db.insert(researchCycleEvents).values({ id: eventId, runId: data.runId, stage, status: "running", attempt: 1, maxAttempts: 1, startedAt }));
  try {
    const metrics = await executeResearchStage(stage, { ...data, stage });
    const result = { durationMs: Date.now() - startedAt.valueOf(), ...metrics };
    await withDatabase((db) => db.update(researchCycleEvents).set({ status: "completed", metrics: result, completedAt: new Date() }).where(eq(researchCycleEvents.id, eventId)));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown stage error";
    await withDatabase((db) => db.update(researchCycleEvents).set({ status: "failed", message, completedAt: new Date() }).where(eq(researchCycleEvents.id, eventId)));
    throw error;
  }
}

export async function runDirectResearchCycle(trigger = "scheduled") {
  const runId = `cycle:${crypto.randomUUID()}`;
  const correlationId = createCorrelationId();
  const data: ResearchCycleJobData = { runId, trigger, correlationId, windowStartedAt: new Date().toISOString() };
  const metrics: Record<string, unknown> = {};
  await withDatabase((db) => db.insert(researchCycleRuns).values({ id: runId, trigger, status: "running", stage: "starting", correlationId, workerId: "direct-scheduled-runner", lastHeartbeatAt: new Date() }));
  let completed = 0;
  try {
    for (const group of RESEARCH_STAGE_GROUPS) {
      const results = await Promise.all(group.map(async (stage) => [stage, await runStage(data, stage)] as const));
      for (const [stage, result] of results) metrics[stage] = result;
      completed += group.length;
      await withDatabase((db) => db.update(researchCycleRuns).set({ stage: group.at(-1) ?? "running", progress: stageProgress(completed), metrics, lastHeartbeatAt: new Date() }).where(eq(researchCycleRuns.id, runId)));
    }
    await withDatabase((db) => db.update(researchCycleRuns).set({ status: "completed", stage: "completed", progress: 100, metrics, completedAt: new Date(), lastHeartbeatAt: new Date() }).where(eq(researchCycleRuns.id, runId)));
    return { id: runId, metrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown research-cycle error";
    await withDatabase((db) => db.update(researchCycleRuns).set({ status: "failed", stage: "failed", error: message, metrics, completedAt: new Date(), lastHeartbeatAt: new Date() }).where(eq(researchCycleRuns.id, runId)));
    throw error;
  }
}
