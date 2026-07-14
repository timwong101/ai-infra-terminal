import assert from "node:assert/strict";
import test from "node:test";
import type { IrSourceConfig } from "@/data/ir-sources";
import { deduplicateIrDocuments, normalizeIrPage } from "@/lib/ir/normalize";
import type { IrDocument } from "@/lib/ir/types";

const config: IrSourceConfig = {
  companyId: "coreweave",
  companyName: "CoreWeave",
  ticker: "CRWV",
  pages: ["https://investors.coreweave.com/news/"],
  allowedHosts: ["investors.coreweave.com"],
  includePathFragments: ["/news/"],
};

test("normalizes dated official IR documents and excludes navigation and SEC mirrors", () => {
  const html = `
    <main>
      <article><time>May 7, 2026</time><h3><a href="/news/q1-results">CoreWeave Reports First Quarter 2026 Financial Results</a></h3></article>
      <article><time>April 15, 2026</time><h3>Jane Street Signs $6 Billion AI Cloud Agreement</h3><a href="/news/jane-street">Continue Reading</a></article>
      <article><time>March 1, 2026</time><h3><a href="/sec-filings/10-q">Quarterly SEC filing</a></h3></article>
      <a href="/news/">View all news</a>
    </main>`;

  const documents = normalizeIrPage(config, config.pages[0], html, "2026-07-12T12:00:00.000Z");
  assert.equal(documents.length, 2);
  assert.equal(documents[0].documentType, "Earnings Release");
  assert.equal(documents[0].publishedAt, "2026-05-07");
  assert.equal(documents[1].title, "Jane Street Signs $6 Billion AI Cloud Agreement");
  assert.ok(documents.every((document) => document.sourceUrl.startsWith("https://investors.coreweave.com/")));
});

test("normalizes official Q4 RSS press-release feeds", () => {
  const rss = `<?xml version="1.0"?><rss><channel><item>
    <title>CoreWeave Reports First Quarter 2026 Results</title>
    <link>https://investors.coreweave.com/news/news-details/2026/q1-results/default.aspx</link>
    <pubDate>Thu, 07 May 2026 16:15:00 -0400</pubDate>
  </item></channel></rss>`;
  const documents = normalizeIrPage(config, "https://investors.coreweave.com/rss/pressrelease.aspx", rss, "2026-07-12T12:00:00.000Z");
  assert.equal(documents.length, 1);
  assert.equal(documents[0].publishedAt, "2026-05-07");
  assert.equal(documents[0].documentType, "Earnings Release");
});

test("normalizes cards with sibling dates, headings, and download links", () => {
  const html = `<section class="release-card"><span>Mar 4, 2026</span><h2>CoreWeave Expands AI Cloud Capacity</h2><a href="/news/capacity.pdf">Download</a></section>`;
  const documents = normalizeIrPage(config, config.pages[0], html, "2026-07-12T12:00:00.000Z");
  assert.equal(documents.length, 1);
  assert.equal(documents[0].title, "CoreWeave Expands AI Cloud Capacity");
  assert.equal(documents[0].publishedAt, "2026-03-04");
});

test("withholds ambiguous records when one source URL maps to different titles", () => {
  const base: IrDocument = {
    id: "ir:coreweave:2026-03-04:capacity",
    companyId: "coreweave",
    companyName: "CoreWeave",
    ticker: "CRWV",
    documentType: "Press Release",
    publishedAt: "2026-03-04",
    title: "CoreWeave Expands AI Cloud Capacity",
    summary: "Official company operating or strategic update",
    sourceUrl: "https://investors.coreweave.com/news/shared.pdf",
    sourcePageUrl: config.pages[0],
    fetchedAt: "2026-07-12T12:00:00.000Z",
    sourceQuality: 82,
    relevanceScore: 70,
    signal: "neutral",
  };

  const documents = deduplicateIrDocuments([
    base,
    { ...base, id: "ir:coreweave:2026-03-04:results", title: "CoreWeave Reports Quarterly Results" },
  ]);
  assert.equal(documents.length, 0);
});

test("keeps Nebius financial documents inside their reporting-period cards", () => {
  const nebiusConfig: IrSourceConfig = {
    companyId: "nebius",
    companyName: "Nebius",
    ticker: "NBIS",
    pages: ["https://nebius.com/financials"],
    allowedHosts: ["nebius.com", "assets.nebius.com"],
    includePathFragments: ["/assets/"],
  };
  const html = `
    <div class="pc-attachment-card"><div>Q1 2026</div><time>May 13, 2026</time>
      <a href="https://assets.nebius.com/assets/q1-results.pdf">Earnings release</a>
      <a href="https://assets.nebius.com/assets/q1-letter.pdf">Letter to shareholders</a>
    </div>
    <div class="pc-attachment-card"><div>Q4 / FY 2025</div><time>February 12, 2026</time>
      <a href="https://assets.nebius.com/assets/q4-results.pdf">Earnings release</a>
    </div>`;

  const documents = normalizeIrPage(nebiusConfig, nebiusConfig.pages[0], html, "2026-07-12T12:00:00.000Z");
  assert.equal(documents.length, 3);
  assert.equal(documents[0].title, "Nebius Q1 2026 Earnings release");
  assert.equal(documents[0].documentType, "Earnings Release");
  assert.equal(documents[1].title, "Nebius Q1 2026 Letter to shareholders");
  assert.equal(documents[1].documentType, "Shareholder Letter");
  assert.equal(documents[2].title, "Nebius Q4 / FY 2025 Earnings release");
  assert.match(documents[2].sourceUrl, /q4-results\.pdf/);
});
