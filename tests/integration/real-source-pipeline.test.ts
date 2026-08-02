import assert from "node:assert/strict";
import test from "node:test";
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

test("archived SEC bytes flow through extraction, integrity verification, evidence, and briefing", async () => {
  await ensureDemoIdentity();
  await withDatabase((db) => db.insert(companies).values({
    id: "coreweave",
    name: "CoreWeave",
    ticker: "CRWV",
    cik: "0001951443",
  }).onConflictDoNothing());
  const filingId = "sec:1951443:0001951443-26-900001";
  const sourceUrl = "https://www.sec.gov/Archives/edgar/data/1951443/000195144326900001/portfolio-fixture.htm";
  const html = `<!doctype html><html><head><title>CoreWeave Portfolio Pipeline Fixture</title></head><body>
    <h2>Data Center Capacity</h2>
    <p>CoreWeave reported that active power capacity across its AI data center platform reached three hundred megawatts, with additional contracted campuses under construction and scheduled through 2027 to support customer GPU clusters.</p>
    <h2>Customers and Demand</h2>
    <p>The company signed multi-year infrastructure agreements with investment-grade customers, increasing contracted backlog while preserving delivery milestones, minimum capacity commitments, and explicit deployment schedules for accelerated computing services.</p>
    <h2>Liquidity and Capital Resources</h2>
    <p>CoreWeave ended the period with committed financing and available liquidity for construction, while management identified interest expense, customer concentration, and utilization ramp timing as material execution risks.</p>
  </body></html>`;
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
    filedAt: "2026-07-31",
    periodOfReport: "2026-07-31",
    accessionNumber: "0001951443-26-900001",
    sourceUrl,
  }, archived.version.fetchedAt.toISOString());

  assert.ok(detail.sections.length >= 3, "the real parser should identify all fixture research sections");
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
