import assert from "node:assert/strict";
import test from "node:test";
import { selectDefaultReportingPeriod } from "@/lib/company-intelligence/period-selection";

const periods = [
  { id: "q3", periodKind: "quarter", periodBasis: "fiscal", evidenceCount: 0 },
  { id: "q2", periodKind: "quarter", periodBasis: "fiscal", evidenceCount: 14 },
  { id: "q1", periodKind: "quarter", periodBasis: "fiscal", evidenceCount: 20 },
];

test("defaults to the newest extracted period instead of an empty discovered period", () => {
  assert.equal(selectDefaultReportingPeriod(periods)?.id, "q2");
});

test("honors an explicitly requested incomplete period", () => {
  assert.equal(selectDefaultReportingPeriod(periods, "q3")?.id, "q3");
});

test("prefers a period with canonical metrics when available", () => {
  assert.equal(selectDefaultReportingPeriod(periods, undefined, new Set(["q1"]))?.id, "q1");
});
