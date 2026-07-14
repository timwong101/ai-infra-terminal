import assert from "node:assert/strict";
import test from "node:test";
import { compareFilings, textSimilarity } from "@/lib/evidence/compare";
import type { FilingEvidenceSection, SecFilingDetail } from "@/lib/evidence/types";

function section(id: string, title: string, category: string, text: string): FilingEvidenceSection {
  return { id, title, category, passages: [{ id: `${id}-passage-1`, text, wordCount: text.split(/\s+/).length }] };
}

function detail(filingId: string, filedAt: string, sections: FilingEvidenceSection[], formType = "10-Q"): SecFilingDetail {
  return {
    filingId,
    companyId: "coreweave",
    companyName: "CoreWeave",
    ticker: "CRWV",
    formType,
    filedAt,
    accessionNumber: filingId.split(":").at(-1) ?? filingId,
    documentTitle: "Quarterly report",
    sourceUrl: `https://www.sec.gov/${filingId}`,
    retrievedAt: "2026-07-12T12:00:00.000Z",
    wordCount: 100,
    sections,
    extraction: { method: "deterministic-html", quality: "high", message: "Test" },
  };
}

test("detects recurring changes without treating omitted language as removal", () => {
  const previous = detail("sec:1:previous", "2026-03-31", [
    section("risk", "Risk Factors", "Risk", "Our business requires capital investment in data centers and access to financing for new customer deployments."),
    section("customer", "Customers and Demand", "Demand", "One customer represented a meaningful portion of contracted revenue during the period."),
  ]);
  const current = detail("sec:1:current", "2026-06-30", [
    section("risk", "Risk Factors", "Risk", "Our business requires substantial capital investment in data centers and additional debt financing for new customer capacity deployments."),
    section("liquidity", "Liquidity and Capital Resources", "Liquidity", "Available liquidity depends on continued financing access and disciplined capital spending for infrastructure."),
  ]);

  const comparison = compareFilings(current, previous);

  assert.ok(comparison);
  assert.equal(comparison.mode, "periodic");
  assert.equal(comparison.counts.modified, 1);
  assert.equal(comparison.counts.added, 1);
  assert.equal(comparison.counts.not_repeated, 1);
  assert.equal(comparison.counts.explicitly_removed, 0);
  assert.equal(comparison.changes[0].significance, "high");
  assert.match(comparison.changes.find((change) => change.type === "modified")?.summary ?? "", /language changed/);
  assert.match(comparison.changes.find((change) => change.type === "not_repeated")?.summary ?? "", /not treated as a thesis change/);
});

test("treats near-identical passages as unchanged", () => {
  assert.ok(textSimilarity(
    "Capital spending supports new data center capacity for customers.",
    "Capital spending supports new data center capacity for customers.",
  ) > 0.9);

  const priorSection = section("risk", "Risk Factors", "Risk", "Capital spending supports new data center capacity for customers.");
  const comparison = compareFilings(
    detail("sec:1:current", "2026-06-30", [priorSection]),
    detail("sec:1:previous", "2026-03-31", [priorSection]),
  );
  assert.ok(comparison);
  assert.deepEqual(comparison.counts, { new_event: 0, added: 0, modified: 0, not_repeated: 0, explicitly_removed: 0 });
  assert.deepEqual(comparison.changes, []);
});

test("treats event filings as standalone evidence instead of diffs", () => {
  const priorEvent = detail("sec:1:event-prior", "2026-06-01", [
    section("contract", "Item 1.01 Material Agreement", "Business", "The company entered a customer capacity agreement."),
  ], "8-K");
  const currentEvent = detail("sec:1:event-current", "2026-06-15", [
    section("financing", "Item 2.03 Financial Obligation", "Liquidity", "The company entered a new equipment financing facility."),
  ], "8-K");

  const comparison = compareFilings(currentEvent, priorEvent);

  assert.ok(comparison);
  assert.equal(comparison.mode, "event");
  assert.equal(comparison.previousFiling, null);
  assert.equal(comparison.counts.new_event, 1);
  assert.equal(comparison.counts.not_repeated, 0);
  assert.deepEqual(comparison.changes.map((change) => change.type), ["new_event"]);
  assert.equal(comparison.changes[0].eventType, "Financial obligation");
  assert.equal(comparison.changes[0].category, "Funding");
  assert.ok((comparison.changes[0].relevanceScore ?? 0) >= 75);
});

test("does not create event signals from administrative filing items", () => {
  const comparison = compareFilings(detail("sec:1:vote", "2026-06-20", [
    section("vote", "Item 5.07: Submission of Matters to a Vote of Security Holders", "Filing item", "The proposal references data center capacity described in the proxy statement."),
    section("exhibits", "Financial Statements", "Financials", "10.1 Credit Agreement incorporated by reference into this item and furnished as an exhibit."),
  ], "8-K"));

  assert.ok(comparison);
  assert.equal(comparison.counts.new_event, 0);
  assert.deepEqual(comparison.changes, []);
});

test("compares amendments with their base filing", () => {
  const base = detail("sec:1:base", "2026-06-01", [
    section("overview", "Filing Overview", "Overview", "The report contains an original disclosure statement."),
  ], "10-Q");
  const amendment = detail("sec:1:amendment", "2026-06-10", [
    section("overview", "Filing Overview", "Overview", "The report contains a corrected and expanded disclosure statement."),
  ], "10-Q/A");

  const comparison = compareFilings(amendment, base);

  assert.ok(comparison);
  assert.equal(comparison.mode, "amendment");
  assert.equal(comparison.previousFiling?.filingId, base.filingId);
  assert.equal(comparison.counts.modified, 1);
});

test("limits periodic comparisons to recurring analytical sections", () => {
  const current = detail("sec:1:current", "2026-06-30", [
    section("exhibit", "Exhibit Index", "Exhibits", "A newly listed exhibit should not become a research change."),
  ]);
  const previous = detail("sec:1:previous", "2026-03-31", [
    section("exhibit", "Exhibit Index", "Exhibits", "An older exhibit should not be treated as removed."),
  ]);

  const comparison = compareFilings(current, previous);

  assert.ok(comparison);
  assert.equal(comparison.changes.length, 0);
  assert.equal(comparison.counts.not_repeated, 0);
});
