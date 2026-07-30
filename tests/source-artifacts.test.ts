import assert from "node:assert/strict";
import test from "node:test";
import {
  artifactStorageKey,
  diffExtractionSnapshots,
  extractionOutputHash,
  sha256,
  stableJson,
} from "@/lib/artifacts/policy";
import type { SecFilingDetail } from "@/lib/evidence/types";

function snapshot(passages: Array<{ id: string; text: string }>, wordCount = 20): SecFilingDetail {
  return {
    filingId: "sec:1:fixture",
    companyId: "coreweave",
    companyName: "CoreWeave",
    ticker: "CRWV",
    formType: "10-Q",
    filedAt: "2026-03-31",
    periodOfReport: "2026-03-31",
    accessionNumber: "0000000000-26-000001",
    documentTitle: "Fixture filing",
    sourceUrl: "https://www.sec.gov/Archives/edgar/data/1/fixture.htm",
    retrievedAt: "2026-04-01T00:00:00.000Z",
    wordCount,
    sections: [{
      id: "capacity",
      title: "Capacity",
      category: "Power & capacity",
      passages: passages.map((item) => ({ ...item, wordCount: item.text.split(/\s+/).length })),
    }],
    extraction: { method: "deterministic-html", quality: "high", message: "Fixture" },
  };
}

test("content-addressed source keys are deterministic and partitioned", () => {
  const hash = sha256(new TextEncoder().encode("immutable source"));
  assert.equal(hash, "fc17afe4af56fca9d2943b7901e7517611b37a36db7a7775b3e341e7d20a6ba0");
  assert.equal(artifactStorageKey(hash), `sha256/fc/17/${hash}`);
});

test("stable extraction hashes ignore object key insertion order", () => {
  assert.equal(stableJson({ z: 1, a: { y: 2, b: 3 } }), stableJson({ a: { b: 3, y: 2 }, z: 1 }));
  assert.equal(extractionOutputHash(snapshot([{ id: "p1", text: "Capacity reached three hundred megawatts." }])), extractionOutputHash(snapshot([{ id: "p1", text: "Capacity reached three hundred megawatts." }])));
});

test("parser replay diff separates added, removed, changed, and unchanged passages", () => {
  const before = snapshot([
    { id: "p1", text: "Capacity reached three hundred megawatts." },
    { id: "p2", text: "The company retained its prior guidance." },
    { id: "p3", text: "Construction remained on schedule." },
  ], 30);
  const after = snapshot([
    { id: "p1", text: "Capacity reached three hundred and twenty megawatts." },
    { id: "p2", text: "The company retained its prior guidance." },
    { id: "p4", text: "A new campus entered service." },
  ], 34);
  assert.deepEqual(diffExtractionSnapshots(before, after), {
    beforeSections: 1,
    afterSections: 1,
    beforePassages: 3,
    afterPassages: 3,
    addedPassages: 1,
    removedPassages: 1,
    changedPassages: 1,
    unchangedPassages: 1,
    wordCountDelta: 4,
  });
});
