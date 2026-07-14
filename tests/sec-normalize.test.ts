import assert from "node:assert/strict";
import test from "node:test";
import type { SecCompany } from "@/data/companies";
import { validateSecUserAgent } from "@/lib/sec/client";
import { buildSecArchiveUrl, findUnexpectedIssuerForms, normalizeSecSubmissions } from "@/lib/sec/normalize";
import type { SecSubmissionsResponse } from "@/lib/sec/types";

const company: SecCompany = {
  id: "coreweave",
  name: "CoreWeave",
  ticker: "CRWV",
  cik: "0001769628",
  forms: ["10-Q", "8-K"],
  regimes: [{ classification: "domestic", effectiveFrom: "0000-01-01", forms: ["10-Q", "8-K"] }],
};

const submissions: SecSubmissionsResponse = {
  cik: "0001769628",
  name: "CoreWeave, Inc.",
  tickers: ["CRWV"],
  filings: {
    recent: {
      accessionNumber: ["0001769628-26-000222", "0001769628-24-000001"],
      filingDate: ["2026-05-08", "2024-01-01"],
      reportDate: ["2026-03-31", "2023-12-31"],
      acceptanceDateTime: ["2026-05-07T19:21:42.000Z", "2024-01-01T12:00:00.000Z"],
      form: ["10-Q", "S-1"],
      primaryDocument: ["crwv-20260331.htm", "old.htm"],
      primaryDocDescription: ["10-Q", "S-1"],
    },
  },
};

test("normalizes relevant recent filings with permanent SEC URLs", () => {
  const events = normalizeSecSubmissions(
    company,
    submissions,
    "2026-07-12T20:00:00.000Z",
    "2025-07-12",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].formType, "10-Q");
  assert.equal(events[0].sourceQuality, 92);
  assert.equal(
    events[0].sourceUrl,
    "https://www.sec.gov/Archives/edgar/data/1769628/000176962826000222/crwv-20260331.htm",
  );
});

test("builds archive URLs without leading CIK zeros or accession dashes", () => {
  assert.equal(
    buildSecArchiveUrl("0001513845", "0001104659-26-074352", "filing.htm"),
    "https://www.sec.gov/Archives/edgar/data/1513845/000110465926074352/filing.htm",
  );
});

test("requires an identifying SEC user agent with a contact email", () => {
  assert.throws(() => validateSecUserAgent(undefined), /SEC_USER_AGENT is required/);
  assert.throws(() => validateSecUserAgent("AI Infra Terminal"), /contact email/);
  assert.equal(
    validateSecUserAgent("AI Infra Terminal research@example.com"),
    "AI Infra Terminal research@example.com",
  );
});

test("applies IREN reporting forms by effective date and warns on mismatches", () => {
  const iren: SecCompany = {
    id: "iren",
    name: "IREN",
    ticker: "IREN",
    cik: "0001878848",
    forms: ["20-F", "6-K", "10-K", "10-Q", "8-K"],
    regimes: [
      { classification: "foreign-private", effectiveFrom: "0000-01-01", effectiveTo: "2025-06-30", forms: ["20-F", "6-K"] },
      { classification: "domestic", effectiveFrom: "2025-07-01", forms: ["10-K", "10-Q", "8-K"] },
    ],
  };
  const transitionSubmissions: SecSubmissionsResponse = {
    ...submissions,
    filings: { recent: {
      accessionNumber: ["a", "b", "c", "d"],
      filingDate: ["2025-06-30", "2025-07-01", "2025-07-02", "2025-06-29"],
      reportDate: ["", "", "", ""],
      acceptanceDateTime: ["", "", "", ""],
      form: ["6-K", "8-K", "6-K", "10-Q"],
      primaryDocument: ["a.htm", "b.htm", "c.htm", "d.htm"],
      primaryDocDescription: ["", "", "", ""],
    } },
  };

  const normalized = normalizeSecSubmissions(iren, transitionSubmissions, "2025-07-03T00:00:00.000Z", "2025-01-01");
  assert.deepEqual(normalized.map((filing) => filing.formType), ["8-K", "6-K"]);
  assert.deepEqual(normalized.map((filing) => filing.issuerClassification), ["domestic", "foreign-private"]);
  assert.equal(findUnexpectedIssuerForms(iren, transitionSubmissions, "2025-01-01").length, 2);
});
