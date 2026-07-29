import test from "node:test";
import assert from "node:assert/strict";
import {
  createTraceId,
  cycleJobId,
  RESEARCH_STAGE_GROUPS,
  retryDelay,
  stageJobId,
  stageProgress,
} from "@/lib/operations/queue-contracts";
import { RESEARCH_STAGE_NAMES } from "@/lib/operations/types";

test("research stage graph covers every stage exactly once", () => {
  const stages = RESEARCH_STAGE_GROUPS.flat();
  assert.deepEqual(new Set(stages), new Set(RESEARCH_STAGE_NAMES));
  assert.equal(stages.length, RESEARCH_STAGE_NAMES.length);
});

test("source discovery runs in parallel before evidence synchronization", () => {
  assert.deepEqual(RESEARCH_STAGE_GROUPS[0], ["ingesting-sec", "ingesting-ir", "refreshing-events"]);
  assert.deepEqual(RESEARCH_STAGE_GROUPS[1], ["syncing-evidence"]);
});

test("queue job IDs are deterministic and BullMQ-safe", () => {
  assert.equal(cycleJobId("cycle:abc"), "cycle-abc--initial");
  assert.equal(stageJobId("cycle:abc", "ingesting-sec"), "cycle-abc--ingesting-sec--initial");
  assert.doesNotMatch(stageJobId("cycle:abc", "ingesting-sec"), /:/);
});

test("stage progress is bounded and reaches 100 percent", () => {
  assert.equal(stageProgress(0), 0);
  assert.equal(stageProgress(4), 50);
  assert.equal(stageProgress(8), 100);
  assert.equal(stageProgress(20), 100);
});

test("retry delay follows exponential backoff", () => {
  assert.equal(retryDelay(1), 1_500);
  assert.equal(retryDelay(2), 3_000);
  assert.equal(retryDelay(3), 6_000);
});

test("trace IDs use the W3C 16-byte hexadecimal shape", () => {
  const first = createTraceId();
  const second = createTraceId();
  assert.match(first, /^[a-f0-9]{32}$/);
  assert.notEqual(first, second);
});
