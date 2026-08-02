import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { archiveSourceBytes, recordInitialExtraction, verifyArtifactIntegrityBatch } from "@/lib/artifacts/service";
import { getCurrentArchivedSource } from "@/lib/artifacts/repository";
import { ensureDemoIdentity } from "@/lib/auth/session";
import { withDatabase } from "@/lib/db/client";
import { persistFilingDetail } from "@/lib/db/evidence-repository";
import { companies, researchEvidence } from "@/lib/db/schema";
import { createResearchBriefing } from "@/lib/operations/briefing";
import { syncResearchEvidence } from "@/lib/research/evidence";
import { extractSecFilingDetail } from "@/lib/sec/extract";

const databaseUrl = process.env.E2E_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required for the real source pipeline test.");
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!/(?:^|_)(?:e2e|test)$/.test(databaseName)) throw new Error(`Refusing to use non-test database ${databaseName}.`);

test("a sanitized real SEC filing excerpt flows through extraction, integrity verification, evidence, and briefing", async () => {
  await ensureDemoIdentity();
  await withDatabase((db) => db.insert(companies).values({
    id: "coreweave",
    name: "CoreWeave",
    ticker: "CRWV",
    cik: "0001769628",
  }).onConflictDoNothing());
  const filingId = "sec:1769628:0001769628-26-000291";
  const sourceUrl = "https://www.sec.gov/Archives/edgar/data/1769628/000176962826000291/crwv-20260618.htm";
  const html = await readFile(new URL("../fixtures/sec/coreweave-2026-06-18-8k.html", import.meta.url), "utf8");
  const bytes = new TextEncoder().encode(html);
  const archived = await archiveSourceBytes({
    sourceKind: "sec",
    sourceDocumentId: filingId,
    companyId: "coreweave",
    sourceUrl,
    bytes,
    contentType: "text/html; charset=utf-8",
    fetchedAt: "2026-07-31T12:00:00.000Z",
  });
  const detail = extractSecFilingDetail(html, {
    filingId,
    companyId: "coreweave",
    companyName: "CoreWeave",
    ticker: "CRWV",
    formType: "8-K",
    filedAt: "2026-06-18",
    periodOfReport: "2026-06-18",
    accessionNumber: "0001769628-26-000291",
    sourceUrl,
  }, archived.version.fetchedAt.toISOString());

  assert.equal(detail.sections.length, 1, "the parser should retain the filing item as one source section");
  assert.ok(detail.sections[0].passages.length >= 3, "the parser should preserve each substantive financing passage inside the filing item");
  assert.equal(await persistFilingDetail(detail), true);
  await recordInitialExtraction(archived, detail, 1);

  const verification = await verifyArtifactIntegrityBatch(1, [archived.artifact.id]);
  assert.equal(verification.corrupt, 0);
  const currentSource = await getCurrentArchivedSource("sec", filingId);
  assert.ok(currentSource?.artifact.verifiedAt, "the archived source should be checksum verified");

  const synced = await syncResearchEvidence();
  assert.ok(synced.sec >= 3);
  const projected = await withDatabase((db) => db.select().from(researchEvidence).where(eq(researchEvidence.sourceDocumentId, filingId)));
  assert.ok(projected && projected.length >= 3, "parsed passages should become queryable research evidence");

  const briefing = await createResearchBriefing({
    workspaceId: "workspace:demo",
    since: new Date(Date.now() - 60 * 60 * 1_000),
    until: new Date(),
  });
  assert.ok(briefing.sections.some((section) => section.companyId === "coreweave"));
  assert.ok(briefing.stats.newEvidence >= projected.length);
});
