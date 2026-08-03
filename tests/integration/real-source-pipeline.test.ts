import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { inArray } from "drizzle-orm";
import { archiveSourceBytes, recordInitialExtraction, verifyArtifactIntegrityBatch } from "@/lib/artifacts/service";
import { getCurrentArchivedSource } from "@/lib/artifacts/repository";
import { ensureDemoIdentity } from "@/lib/auth/session";
import { withDatabase } from "@/lib/db/client";
import { persistFilingDetail } from "@/lib/db/evidence-repository";
import { persistIrDocumentDetail } from "@/lib/db/ir-evidence-repository";
import { companies, researchEvidence } from "@/lib/db/schema";
import { extractIrHtmlDetail } from "@/lib/ir/extract";
import type { IrDocument } from "@/lib/ir/types";
import { createResearchBriefing } from "@/lib/operations/briefing";
import { syncResearchEvidence } from "@/lib/research/evidence";
import { extractSecFilingDetail } from "@/lib/sec/extract";

const databaseUrl = process.env.E2E_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("E2E_DATABASE_URL is required for the real source pipeline test.");
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!/(?:^|_)(?:e2e|test)$/.test(databaseName)) throw new Error(`Refusing to use non-test database ${databaseName}.`);

const companiesUnderTest = [
  { id: "coreweave", name: "CoreWeave", ticker: "CRWV", cik: "0001769628", formType: "8-K", fixture: "coreweave-2026-06-18-8k.html", accession: "0001769628-26-000291", date: "2026-06-18" },
  { id: "nebius", name: "Nebius", ticker: "NBIS", cik: "0001513845", formType: "6-K", fixture: "nebius-2026-06-20-6k.html", accession: "0001513845-26-000292", date: "2026-06-20" },
  { id: "applied-digital", name: "Applied Digital", ticker: "APLD", cik: "0001144879", formType: "8-K", fixture: "applied-digital-2026-06-22-8k.html", accession: "0001144879-26-000293", date: "2026-06-22" },
  { id: "iren", name: "IREN", ticker: "IREN", cik: "0001878848", formType: "8-K", fixture: "iren-2026-06-24-8k.html", accession: "0001878848-26-000294", date: "2026-06-24" },
] as const;

test("sanitized SEC and IR documents for every covered company flow through the durable source pipeline", async () => {
  await ensureDemoIdentity();
  const artifactIds: string[] = [];
  const sourceDocumentIds: string[] = [];

  for (const company of companiesUnderTest) {
    await withDatabase((db) => db.insert(companies).values({ id: company.id, name: company.name, ticker: company.ticker, cik: company.cik }).onConflictDoNothing());

    const filingId = `sec:${Number(company.cik)}:${company.accession}`;
    const secSourceUrl = `https://www.sec.gov/Archives/edgar/data/${Number(company.cik)}/${company.accession.replaceAll("-", "")}/${company.ticker.toLowerCase()}-${company.date.replaceAll("-", "")}.htm`;
    const secHtml = await readFile(new URL(`../fixtures/sec/${company.fixture}`, import.meta.url), "utf8");
    const secArchive = await archiveSourceBytes({
      sourceKind: "sec", sourceDocumentId: filingId, companyId: company.id, sourceUrl: secSourceUrl,
      bytes: new TextEncoder().encode(secHtml), contentType: "text/html; charset=utf-8", fetchedAt: "2026-07-31T12:00:00.000Z",
    });
    const secDetail = extractSecFilingDetail(secHtml, {
      filingId, companyId: company.id, companyName: company.name, ticker: company.ticker, formType: company.formType,
      filedAt: company.date, periodOfReport: company.date, accessionNumber: company.accession, sourceUrl: secSourceUrl,
    }, secArchive.version.fetchedAt.toISOString());
    assert.ok(secDetail.sections.flatMap((section) => section.passages).length >= 2, `${company.name} SEC fixture should yield research passages`);
    assert.equal(await persistFilingDetail(secDetail), true);
    await recordInitialExtraction(secArchive, secDetail, 1);
    artifactIds.push(secArchive.artifact.id);
    sourceDocumentIds.push(filingId);

    const irDocumentId = `ir:${company.id}:2026-capacity-update`;
    const irSourceUrl = `https://investors.example.test/${company.id}/2026-capacity-update`;
    const irHtml = await readFile(new URL(`../fixtures/ir/${company.id}-2026-capacity-update.html`, import.meta.url), "utf8");
    const irArchive = await archiveSourceBytes({
      sourceKind: "ir", sourceDocumentId: irDocumentId, companyId: company.id, sourceUrl: irSourceUrl,
      bytes: new TextEncoder().encode(irHtml), contentType: "text/html; charset=utf-8", fetchedAt: "2026-07-31T12:05:00.000Z",
    });
    const irDocument: IrDocument = {
      id: irDocumentId, companyId: company.id, companyName: company.name, ticker: company.ticker,
      documentType: "Press Release", publishedAt: company.date, title: `${company.name} capacity update`, summary: "Sanitized integration fixture.",
      sourceUrl: irSourceUrl, sourcePageUrl: irSourceUrl, fetchedAt: irArchive.version.fetchedAt.toISOString(), sourceQuality: 90, relevanceScore: 95, signal: "positive",
    };
    const irDetail = extractIrHtmlDetail(irHtml, irDocument, irArchive.version.fetchedAt.toISOString());
    assert.ok(irDetail.sections.flatMap((section) => section.passages).length >= 2, `${company.name} IR fixture should yield research passages`);
    assert.equal(await persistIrDocumentDetail(irDetail), true);
    await recordInitialExtraction(irArchive, irDetail, 1);
    artifactIds.push(irArchive.artifact.id);
    sourceDocumentIds.push(irDocumentId);
  }

  const verification = await verifyArtifactIntegrityBatch(artifactIds.length, artifactIds);
  assert.equal(verification.corrupt, 0);
  assert.equal(verification.verified, artifactIds.length);
  for (const sourceDocumentId of sourceDocumentIds) {
    const sourceKind = sourceDocumentId.startsWith("sec:") ? "sec" : "ir";
    const currentSource = await getCurrentArchivedSource(sourceKind, sourceDocumentId);
    assert.ok(currentSource?.artifact.verifiedAt, `${sourceDocumentId} should retain a checksum-verified source artifact`);
  }

  const synced = await syncResearchEvidence();
  assert.ok(synced.sec >= companiesUnderTest.length * 2);
  assert.ok(synced.ir >= companiesUnderTest.length * 2);
  const projected = await withDatabase((db) => db.select().from(researchEvidence).where(inArray(researchEvidence.sourceDocumentId, sourceDocumentIds)));
  assert.ok(projected);
  for (const company of companiesUnderTest) {
    assert.ok(projected.some((item) => item.companyId === company.id && item.sourceKind === "sec"), `${company.name} should have projected SEC evidence`);
    assert.ok(projected.some((item) => item.companyId === company.id && item.sourceKind === "ir"), `${company.name} should have projected IR evidence`);
  }

  const briefing = await createResearchBriefing({ workspaceId: "workspace:demo", since: new Date(Date.now() - 60 * 60 * 1_000), until: new Date() });
  for (const company of companiesUnderTest) assert.ok(briefing.sections.some((section) => section.companyId === company.id));
  assert.ok(briefing.stats.newEvidence > 0, "the bounded briefing should include newly projected evidence");
});
