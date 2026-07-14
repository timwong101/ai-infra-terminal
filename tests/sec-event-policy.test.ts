import assert from "node:assert/strict";
import test from "node:test";
import { normalizeSecEvent } from "@/lib/evidence/sec-event-policy";
import type { FilingEvidenceSection } from "@/lib/evidence/types";

function event(itemCode: string | undefined, title: string, category: string, text: string, formType = "8-K") {
  const section: FilingEvidenceSection = {
    id: `section-${itemCode ?? "overview"}`,
    title,
    category,
    itemCode,
    passages: [{ id: "passage-1", text, wordCount: text.split(/\s+/).length }],
  };
  return normalizeSecEvent(formType, section, section.passages[0]);
}

test("normalizes material financing events with SEC item context", () => {
  const result = event(
    "2.03",
    "Item 2.03: Creation of a Direct Financial Obligation",
    "Filing item",
    "The company entered a $430 million revolving credit facility with equipment financing for new data center capacity.",
  );

  assert.equal(result.eventType, "Financial obligation");
  assert.equal(result.category, "Funding");
  assert.equal(result.eligible, true);
  assert.ok(result.relevanceScore >= 75);
  assert.match(result.relevanceReason, /funding evidence/);
});

test("suppresses administrative shareholder votes even when copied text mentions capacity", () => {
  const result = event(
    "5.07",
    "Item 5.07: Submission of Matters to a Vote of Security Holders",
    "Filing item",
    "The proposal references data center capacity and power infrastructure described elsewhere in the proxy statement.",
  );

  assert.equal(result.eventType, "Shareholder vote");
  assert.equal(result.eligible, false);
  assert.match(result.relevanceReason, /administrative/);
});

test("suppresses exhibits and incorporation-by-reference boilerplate", () => {
  const result = event(
    "9.01",
    "Financial Statements",
    "Financials",
    "10.1 Credit Agreement incorporated by reference into this item and furnished as an exhibit.",
  );

  assert.equal(result.eligible, false);
  assert.match(result.relevanceReason, /Administrative|administrative/);
});

test("promotes substantive 6-K infrastructure updates without SEC item codes", () => {
  const result = event(
    undefined,
    "Filing Overview",
    "Overview",
    "The company expanded its AI data center cluster by 200MW under a contracted customer workload agreement.",
    "6-K",
  );

  assert.equal(result.eventType, "Foreign issuer update");
  assert.equal(result.category, "Capacity");
  assert.equal(result.eligible, true);
  assert.ok(result.relevanceScore >= 70);
});
