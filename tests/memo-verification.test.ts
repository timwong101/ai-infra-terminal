import assert from "node:assert/strict";
import test from "node:test";
import { verifyMemoSections } from "@/lib/research/memos";
import type { ComparisonMemoSection, ResearchEvidenceItem } from "@/lib/research/types";

const evidence = [
  { id: "e-a", companyId: "a" },
  { id: "e-b", companyId: "b" },
] as ResearchEvidenceItem[];

test("keeps only claims grounded in same-company evidence", () => {
  const sections: ComparisonMemoSection[] = [{
    key: "summary",
    title: "Summary",
    claims: [
      { companyId: "a", text: "Grounded", citationIds: ["e-a"] },
      { companyId: "a", text: "Cross-company", citationIds: ["e-b"] },
      { companyId: "b", text: "Unsupported", citationIds: [] },
    ],
  }];
  const result = verifyMemoSections(sections, evidence, ["a", "b"]);
  assert.deepEqual(result.sections.find((section) => section.key === "summary")?.claims, [
    { companyId: "a", text: "Grounded", citationIds: ["e-a"] },
  ]);
  assert.equal(result.verification.passed, false);
  assert.equal(result.verification.rejectedClaims, 2);
});

test("allows uncited open questions while enforcing known companies", () => {
  const sections: ComparisonMemoSection[] = [{ key: "questions", title: "Questions", claims: [
    { companyId: "b", text: "What remains unknown?", citationIds: [] },
    { companyId: "c", text: "Unknown company", citationIds: [] },
  ] }];
  const result = verifyMemoSections(sections, evidence, ["a", "b"]);
  assert.equal(result.sections.find((section) => section.key === "questions")?.claims.length, 1);
  assert.equal(result.verification.rejectedClaims, 1);
});
