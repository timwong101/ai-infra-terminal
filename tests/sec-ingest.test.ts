import assert from "node:assert/strict";
import test from "node:test";
import type { SecCompany } from "@/data/companies";
import { refreshSecEvidence } from "@/lib/sec/ingest";
import type { SecSubmissionsResponse } from "@/lib/sec/types";

function createSubmissions(company: SecCompany): SecSubmissionsResponse {
  const count = 20;
  const form = company.forms[0];

  return {
    cik: company.cik,
    name: company.name,
    tickers: [company.ticker],
    filings: {
      recent: {
        accessionNumber: Array.from({ length: count }, (_, index) => `0000000000-26-${String(index).padStart(6, "0")}`),
        filingDate: Array.from({ length: count }, (_, index) => `2026-06-${String(28 - index).padStart(2, "0")}`),
        reportDate: Array.from({ length: count }, () => "2026-03-31"),
        acceptanceDateTime: Array.from({ length: count }, () => "20260628120000"),
        form: Array.from({ length: count }, () => form),
        primaryDocument: Array.from({ length: count }, (_, index) => `filing-${index}.htm`),
        primaryDocDescription: Array.from({ length: count }, () => "Test filing"),
      },
    },
  };
}

test("refreshes and caps filings per SEC company", async () => {
  const cache = await refreshSecEvidence({
    userAgent: "Test Terminal test@example.com",
    previousCache: null,
    now: new Date("2026-07-12T12:00:00.000Z"),
    requestDelayMs: 0,
    fetchSubmissions: async (company) => createSubmissions(company),
  });

  assert.equal(cache.filings.length, 60);
  assert.equal(cache.generatedAt, "2026-07-12T12:00:00.000Z");
  assert.deepEqual(cache.errors, []);
  for (const companyId of cache.companies) {
    assert.equal(cache.filings.filter((filing) => filing.companyId === companyId).length, 15);
  }
});

test("fails without replacing the cache when every SEC request fails", async () => {
  await assert.rejects(
    refreshSecEvidence({
      userAgent: "Test Terminal test@example.com",
      previousCache: null,
      requestDelayMs: 0,
      fetchSubmissions: async () => {
        throw new Error("Unavailable");
      },
    }),
    /Every SEC request failed/,
  );
});
