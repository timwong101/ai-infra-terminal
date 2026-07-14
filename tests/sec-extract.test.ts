import assert from "node:assert/strict";
import test from "node:test";
import { extractSecFilingDetail } from "@/lib/sec/extract";

const filingMetadata = {
  filingId: "sec:0001769628:0001769628-26-000222",
  companyId: "coreweave",
  companyName: "CoreWeave",
  ticker: "CRWV",
  formType: "10-Q",
  filedAt: "2026-05-08",
  accessionNumber: "0001769628-26-000222",
  sourceUrl: "https://www.sec.gov/Archives/edgar/data/1769628/000176962826000222/crwv-20260331.htm",
};

test("extracts citation-ready passages from relevant filing sections", () => {
  const html = `
    <html>
      <head><title>CoreWeave Quarterly Report</title><style>p { color: red; }</style></head>
      <body>
        <ix:header><xbrli:context>00017696282026-03-31us-gaap:CommonStockMember</xbrli:context></ix:header>
        <ix:hidden>Hidden XBRL metadata must not become evidence.</ix:hidden>
        <div style="display:none">Additional hidden taxonomy metadata.</div>
        <p>This quarterly report summarizes the company's financial position and operating performance for the period, including material developments affecting infrastructure capacity.</p>
        <h2>ITEM 1A. RISK FACTORS</h2>
        <p>Our business requires substantial capital investment in data centers and accelerated computing systems. Delays in financing or construction could reduce available capacity and adversely affect customer deployments.</p>
        <h2>Liquidity and Capital Resources</h2>
        <p>We fund operations through customer receipts, borrowings, and equipment financing. Available liquidity depends on continued access to capital and disciplined deployment of new infrastructure.</p>
        <h2>ITEM 1.01 Entry into a Material Definitive Agreement</h2>
        <p>The company entered into a long-term data center lease that provides additional powered capacity for future customer workloads and requires staged capital commitments.</p>
      </body>
    </html>
  `;

  const detail = extractSecFilingDetail(html, filingMetadata, "2026-07-12T12:00:00.000Z");

  assert.equal(detail.documentTitle, "CoreWeave Quarterly Report");
  assert.equal(detail.retrievedAt, "2026-07-12T12:00:00.000Z");
  assert.equal(detail.sections.length, 4);
  assert.deepEqual(detail.sections.map((section) => section.title), [
    "Filing Overview",
    "Risk Factors",
    "Liquidity and Capital Resources",
    "Material Agreement",
  ]);
  assert.match(detail.sections[1].passages[0].text, /substantial capital investment/);
  assert.equal(detail.sections[3].itemCode, "1.01");
  assert.doesNotMatch(detail.sections.flatMap((section) => section.passages.map((passage) => passage.text)).join(" "), /XBRL metadata|CommonStockMember/);
  assert.equal(detail.extraction.quality, "high");
  assert.ok(detail.sections.every((section) => section.passages.every((passage) => passage.text.length <= 1_100)));
});

test("returns a limited result when the filing has no narrative evidence", () => {
  const detail = extractSecFilingDetail(
    "<html><head><title>Exhibit Index</title></head><body><p>Exhibit 99.1</p></body></html>",
    filingMetadata,
  );

  assert.deepEqual(detail.sections, []);
  assert.equal(detail.extraction.quality, "limited");
});
