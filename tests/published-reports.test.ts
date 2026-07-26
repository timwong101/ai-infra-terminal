import assert from "node:assert/strict";
import test from "node:test";
import { buildPublishedReportSnapshot, publishedReportToMarkdown } from "@/lib/reports/service";
import type { PublishedReport, PublishedReportGeneration } from "@/lib/reports/types";
import type { ComparisonMemo, ResearchEvidenceItem } from "@/lib/research/types";

const evidence = [
  {
    id: "e-coreweave",
    companyId: "coreweave",
    companyName: "CoreWeave",
    sourceType: "SEC 10-Q",
    documentTitle: "Quarterly report",
    documentDate: "2026-02-10",
    excerpt: "CoreWeave disclosed supported infrastructure capacity.",
    sourceUrl: "https://example.com/coreweave",
  },
  {
    id: "e-nebius",
    companyId: "nebius",
    companyName: "Nebius",
    sourceType: "Earnings Release",
    documentTitle: "FY 2025 results",
    documentDate: "2026-02-20",
    excerpt: "Nebius disclosed supported infrastructure capacity.",
    sourceUrl: "https://example.com/nebius",
  },
] as ResearchEvidenceItem[];

function memo(overrides: Partial<ComparisonMemo> = {}): ComparisonMemo {
  return {
    id: "memo:test",
    title: "CoreWeave vs. Nebius",
    question: "Compare disclosed infrastructure exposure.",
    companyA: { id: "coreweave", name: "CoreWeave", ticker: "CRWV" },
    companyB: { id: "nebius", name: "Nebius", ticker: "NBIS" },
    topic: "All topics",
    confidenceScore: 88,
    evidenceQualityScore: 91,
    sourceDiversityScore: 82,
    status: "draft",
    isStale: false,
    staleReason: null,
    staleAt: null,
    sections: [
      { key: "summary", title: "Summary", claims: [
        { companyId: "coreweave", text: "Supported CoreWeave claim.", citationIds: ["e-coreweave"] },
        { companyId: "coreweave", text: "Cross-company citation.", citationIds: ["e-nebius"] },
      ] },
      { key: "questions", title: "Open questions", claims: [
        { companyId: "nebius", text: "What remains undisclosed?", citationIds: [] },
      ] },
    ],
    citations: evidence,
    createdAt: "2026-02-21T00:00:00.000Z",
    updatedAt: "2026-02-21T00:00:00.000Z",
    ...overrides,
  };
}

const generation: PublishedReportGeneration = {
  engine: "deterministic",
  model: "deterministic-v1",
  retrievalMode: "full-text",
  verification: { passed: false, rejectedClaims: 1, checkedClaims: 2, allowedCitations: 2 },
};

test("compliance publishing withholds unsupported claims and unused citations", () => {
  const snapshot = buildPublishedReportSnapshot({
    memo: memo(),
    complianceMode: true,
    generation,
    publisher: { name: "Analyst", workspaceName: "Research" },
  });
  assert.equal(snapshot.compliance.verificationPassed, true);
  assert.equal(snapshot.compliance.withheldClaims, 1);
  assert.equal(snapshot.compliance.publishedClaims, 2);
  assert.deepEqual(snapshot.sections.find((section) => section.key === "summary")?.claims.map((claim) => claim.text), ["Supported CoreWeave claim."]);
  assert.deepEqual(snapshot.citations.map((citation) => citation.id), ["e-coreweave"]);
});

test("compliance publishing withholds stale factual claims but preserves open questions", () => {
  const snapshot = buildPublishedReportSnapshot({
    memo: memo({ isStale: true, staleReason: "Evidence changed." }),
    complianceMode: true,
    generation,
    publisher: { name: "Analyst", workspaceName: "Research" },
  });
  assert.equal(snapshot.compliance.verificationPassed, false);
  assert.equal(snapshot.sections.find((section) => section.key === "summary")?.claims.length, 0);
  assert.equal(snapshot.sections.find((section) => section.key === "questions")?.claims.length, 1);
  assert.equal(snapshot.citations.length, 0);
});

test("Markdown export includes report metadata, verified claims, and source appendix", () => {
  const snapshot = buildPublishedReportSnapshot({
    memo: memo(),
    complianceMode: true,
    generation,
    publisher: { name: "Analyst", workspaceName: "Research" },
  });
  const report = {
    id: "report:test",
    memoId: "memo:test",
    publicToken: "a".repeat(64),
    path: `/reports/${"a".repeat(64)}`,
    version: 1,
    complianceMode: true,
    revokedAt: null,
    publishedAt: "2026-02-21T00:00:00.000Z",
    ...snapshot,
  } satisfies PublishedReport;
  const markdown = publishedReportToMarkdown(report);
  assert.match(markdown, /^# CoreWeave vs\. Nebius/m);
  assert.match(markdown, /Supported CoreWeave claim\. \[1\]/);
  assert.match(markdown, /## Source Appendix/);
  assert.match(markdown, /https:\/\/example\.com\/coreweave/);
  assert.doesNotMatch(markdown, /Cross-company citation/);
});
