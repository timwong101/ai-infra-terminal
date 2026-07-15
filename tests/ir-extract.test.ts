import assert from "node:assert/strict";
import test from "node:test";
import { buildCatalogOnlyIrDetail, classifyIrPassage, extractIrHtmlDetail } from "@/lib/ir/extract";
import type { IrDocument } from "@/lib/ir/types";

const document: IrDocument = {
  id: "ir:nebius:2026-05-13:q1-results",
  companyId: "nebius",
  companyName: "Nebius",
  ticker: "NBIS",
  documentType: "Earnings Release",
  publishedAt: "2026-05-13",
  title: "Nebius Q1 2026 Earnings release",
  summary: "Official company earnings release",
  sourceUrl: "https://assets.nebius.com/assets/q1-results.pdf",
  sourcePageUrl: "https://nebius.com/financials",
  fetchedAt: "2026-07-13T12:00:00.000Z",
  sourceQuality: 90,
  relevanceScore: 90,
  signal: "neutral",
};

test("classifies IR passages into investor research topics", () => {
  assert.equal(classifyIrPassage("We expect secured power capacity to reach 2.5 GW by the end of 2027."), "Capacity");
  assert.equal(classifyIrPassage("Quarterly revenue increased while adjusted EBITDA improved."), "Revenue");
  assert.equal(classifyIrPassage("Capital expenditures will fund property and equipment."), "Capital spending");
  assert.equal(classifyIrPassage("These measures help analysts forecast the evolution of the business."), null);
});

test("extracts citation-ready topic sections from official IR HTML", () => {
  const html = `<main>
    <p>Nebius expects secured data center capacity to reach more than two gigawatts by the end of 2027 as new GPU clusters enter service across multiple regions.</p>
    <p>Quarterly revenue increased significantly and adjusted EBITDA improved as customer demand for AI infrastructure remained strong during the reporting period.</p>
    <p>Capital expenditures are expected to fund property and equipment required for the next phase of infrastructure expansion and deployment.</p>
    <p>General contact information that contains no research evidence and should not become a citation passage despite being long enough for extraction.</p>
  </main>`;
  const detail = extractIrHtmlDetail(html, document, "2026-07-13T12:00:00.000Z");
  assert.equal(detail.extraction.method, "deterministic-html");
  assert.deepEqual(detail.sections.map((section) => section.category), ["Capacity", "Revenue", "Capital spending"]);
  assert.equal(detail.sections.reduce((total, section) => total + section.passages.length, 0), 3);
});

test("retains official catalog metadata when a document host blocks extraction", () => {
  const detail = buildCatalogOnlyIrDetail({
    ...document,
    companyId: "iren",
    companyName: "IREN",
    ticker: "IREN",
    sourceUrl: "https://iren.gcs-web.com/static-files/example",
    sourcePageUrl: "https://iren.com/investors/reports",
  }, "2026-07-15T00:00:00.000Z");
  assert.equal(detail.extraction.quality, "limited");
  assert.equal(detail.sourceUrl, "https://iren.gcs-web.com/static-files/example");
  assert.equal(detail.sourcePageUrl, "https://iren.com/investors/reports");
  assert.equal(detail.sections.length, 0);
  assert.match(detail.extraction.message, /catalog metadata retained/i);
});
