import { createHash, randomBytes } from "node:crypto";
import { RESEARCH_STAGE_NAMES, type ResearchStageName } from "@/lib/operations/types";

export const RESEARCH_CYCLE_QUEUE = "research-cycle";
export const RESEARCH_STAGE_QUEUE = "research-stage";
export const RESEARCH_DEAD_LETTER_QUEUE = "research-dead-letter";
export const RESEARCH_STAGE_ATTEMPTS = 3;
export const RESEARCH_STAGE_BACKOFF_MS = 1_500;

export const RESEARCH_STAGE_GROUPS: readonly (readonly ResearchStageName[])[] = [
  ["ingesting-sec", "ingesting-ir", "refreshing-events"],
  ["verifying-artifacts"],
  ["syncing-evidence"],
  ["updating-company-intelligence", "embedding-evidence"],
  ["updating-theses"],
  ["building-briefing"],
];

export function createCorrelationId() {
  return randomBytes(16).toString("hex");
}

export function queueSafeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function cycleJobId(runId: string, generation = "initial") {
  return `${queueSafeId(runId)}--${queueSafeId(generation)}`;
}

export function stageJobId(runId: string, stage: ResearchStageName, generation = "initial") {
  return `${queueSafeId(runId)}--${stage}--${queueSafeId(generation)}`;
}

export function stageEventId(jobId: string, attempt: number) {
  return `cycle-event:${createHash("sha256").update(`${jobId}:${attempt}`).digest("hex").slice(0, 32)}`;
}

export function stageProgress(completedStages: number) {
  return Math.min(100, Math.round((completedStages / RESEARCH_STAGE_NAMES.length) * 100));
}

export function retryDelay(attempt: number) {
  return RESEARCH_STAGE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
}
