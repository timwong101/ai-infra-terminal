import assert from "node:assert/strict";
import test from "node:test";
import { buildBriefingContent } from "@/lib/operations/briefing";
import type { ResearchBriefingEvidence } from "@/lib/operations/types";

const evidence = [
  { id: "one", companyId: "a", companyName: "Alpha", ticker: "AAA", documentTitle: "Capacity update", documentDate: "2026-07-16", sourceType: "SEC 8-K", topic: "Power & capacity", excerpt: "Alpha energized 100 MW.", sourceUrl: "https://example.com/one", evidenceQualityScore: 88, relevanceScore: 92, duplicateGroupId: "one", reviewStatus: "unreviewed", suggestionStatus: "pending", suggestedImpact: "supports" },
  { id: "two", companyId: "a", companyName: "Alpha", ticker: "AAA", documentTitle: "Risk update", documentDate: "2026-07-15", sourceType: "SEC 10-Q", topic: "Risk factors", excerpt: "Construction remains on schedule.", sourceUrl: "https://example.com/two", evidenceQualityScore: 62, relevanceScore: 55, duplicateGroupId: "two", reviewStatus: "accepted", suggestionStatus: "accepted", suggestedImpact: "watch" },
] satisfies ResearchBriefingEvidence[];

test("builds a company briefing from new evidence without inventing claims", () => {
  const result = buildBriefingContent({
    companies: [{ id: "a", name: "Alpha", ticker: "AAA" }, { id: "b", name: "Beta", ticker: "BBB" }],
    evidence,
    stats: { newDocuments: 1, staleMemos: 2, staleClaims: 0, ingestionFailures: 1 },
  });
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].newEvidence, 2);
  assert.equal(result.sections[0].topEvidence[0].id, "one");
  assert.equal(result.stats.highValueEvidence, 1);
  assert.equal(result.stats.proposedThesisImpacts, 1);
  assert.match(result.summary, /2 new evidence passages across 1 monitored company/i);
});

test("reports a quiet window while retaining operational risks", () => {
  const result = buildBriefingContent({ companies: [], evidence: [], stats: { newDocuments: 0, staleMemos: 3, staleClaims: 1, ingestionFailures: 2 } });
  assert.equal(result.stats.newEvidence, 0);
  assert.equal(result.stats.staleMemos, 3);
  assert.match(result.summary, /No new evidence passages/i);
});
