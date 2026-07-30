import { and, desc, eq, ne } from "drizzle-orm";
import { sourceArtifacts, sourceDocumentVersions, sourceExtractionRuns } from "@/lib/artifacts/schema";
import type { ArtifactIntegritySummary, ArtifactSourceKind, ExtractionDiffSummary, ExtractionSnapshot } from "@/lib/artifacts/types";
import { artifactStorageConfig } from "@/lib/artifacts/storage";
import { filings, irDocuments } from "@/lib/db/schema";
import { withDatabase } from "@/lib/db/client";

export type ArchivedSourceVersion = {
  artifact: typeof sourceArtifacts.$inferSelect;
  version: typeof sourceDocumentVersions.$inferSelect;
};

export async function persistArchivedSource(input: {
  artifactId: string;
  contentHash: string;
  storageKey: string;
  storageBackend: string;
  contentType: string;
  byteLength: number;
  sourceKind: ArtifactSourceKind;
  sourceDocumentId: string;
  companyId: string;
  sourceUrl: string;
  etag?: string | null;
  lastModified?: string | null;
  fetchedAt: Date;
}) {
  const result = await withDatabase(async (db) => db.transaction(async (tx) => {
    const artifact = (await tx.insert(sourceArtifacts).values({
      id: input.artifactId,
      contentHash: input.contentHash,
      storageKey: input.storageKey,
      storageBackend: input.storageBackend,
      storageStatus: "available",
      contentType: input.contentType,
      byteLength: input.byteLength,
    }).onConflictDoUpdate({
      target: sourceArtifacts.contentHash,
      set: { storageStatus: "available", contentType: input.contentType, byteLength: input.byteLength },
    }).returning())[0];

    await tx.update(sourceDocumentVersions).set({ isCurrent: false }).where(and(
      eq(sourceDocumentVersions.sourceKind, input.sourceKind),
      eq(sourceDocumentVersions.sourceDocumentId, input.sourceDocumentId),
    ));
    const versionId = `source-version:${input.sourceKind}:${input.sourceDocumentId}:${input.contentHash.slice(0, 16)}`;
    const version = (await tx.insert(sourceDocumentVersions).values({
      id: versionId,
      artifactId: artifact.id,
      sourceKind: input.sourceKind,
      sourceDocumentId: input.sourceDocumentId,
      companyId: input.companyId,
      sourceUrl: input.sourceUrl,
      etag: input.etag ?? null,
      lastModified: input.lastModified ?? null,
      isCurrent: true,
      fetchedAt: input.fetchedAt,
    }).onConflictDoUpdate({
      target: [sourceDocumentVersions.sourceKind, sourceDocumentVersions.sourceDocumentId, sourceDocumentVersions.artifactId],
      set: {
        sourceUrl: input.sourceUrl,
        etag: input.etag ?? null,
        lastModified: input.lastModified ?? null,
        isCurrent: true,
        fetchedAt: input.fetchedAt,
      },
    }).returning())[0];
    return { artifact, version };
  }));
  if (!result) throw new Error("Postgres is required to record archived source provenance.");
  return result;
}

export async function persistExtractionRun(input: {
  source: ArchivedSourceVersion;
  runKind: "initial" | "reprocess";
  parserName: string;
  parserVersion: string;
  codeVersion: string;
  status: "promoted" | "preview" | "failed";
  outputHash: string;
  outputSnapshot: ExtractionSnapshot;
  passageCount: number;
  sectionCount: number;
  diffSummary: ExtractionDiffSummary;
  durationMs: number;
  error?: string | null;
}) {
  const id = `extraction:${input.source.version.sourceKind}:${input.source.version.sourceDocumentId}:${input.runKind}:${input.parserVersion}:${input.outputHash.slice(0, 16)}`;
  const result = await withDatabase(async (db) => db.transaction(async (tx) => {
    const existing = (await tx.select().from(sourceExtractionRuns).where(and(
      eq(sourceExtractionRuns.sourceVersionId, input.source.version.id),
      eq(sourceExtractionRuns.runKind, input.runKind),
      eq(sourceExtractionRuns.parserVersion, input.parserVersion),
      eq(sourceExtractionRuns.outputHash, input.outputHash),
    )).limit(1))[0];
    const preservePromotion = existing?.status === "promoted" && input.status === "preview";
    if (input.status === "promoted") {
      await tx.update(sourceExtractionRuns).set({ status: "superseded" }).where(and(
        eq(sourceExtractionRuns.sourceKind, input.source.version.sourceKind),
        eq(sourceExtractionRuns.sourceDocumentId, input.source.version.sourceDocumentId),
        eq(sourceExtractionRuns.status, "promoted"),
      ));
    }
    return (await tx.insert(sourceExtractionRuns).values({
      id,
      sourceVersionId: input.source.version.id,
      artifactId: input.source.artifact.id,
      sourceKind: input.source.version.sourceKind,
      sourceDocumentId: input.source.version.sourceDocumentId,
      runKind: input.runKind,
      parserName: input.parserName,
      parserVersion: input.parserVersion,
      codeVersion: input.codeVersion,
      status: input.status,
      inputHash: input.source.artifact.contentHash,
      outputHash: input.outputHash,
      outputSnapshot: input.outputSnapshot,
      passageCount: input.passageCount,
      sectionCount: input.sectionCount,
      diffSummary: input.diffSummary,
      durationMs: input.durationMs,
      error: input.error ?? null,
      completedAt: new Date(),
      promotedAt: input.status === "promoted" ? new Date() : null,
    }).onConflictDoUpdate({
      target: [sourceExtractionRuns.sourceVersionId, sourceExtractionRuns.runKind, sourceExtractionRuns.parserVersion, sourceExtractionRuns.outputHash],
      set: {
        status: preservePromotion ? "promoted" : input.status,
        codeVersion: input.codeVersion,
        outputSnapshot: input.outputSnapshot,
        passageCount: input.passageCount,
        sectionCount: input.sectionCount,
        diffSummary: input.diffSummary,
        durationMs: input.durationMs,
        error: input.error ?? null,
        completedAt: new Date(),
        promotedAt: preservePromotion ? existing.promotedAt : input.status === "promoted" ? new Date() : null,
      },
    }).returning())[0];
  }));
  if (!result) throw new Error("Postgres is required to record extraction history.");
  return result;
}

export async function getCurrentArchivedSource(sourceKind: ArtifactSourceKind, sourceDocumentId: string): Promise<ArchivedSourceVersion | null> {
  return withDatabase(async (db) => {
    const row = (await db.select({ artifact: sourceArtifacts, version: sourceDocumentVersions })
      .from(sourceDocumentVersions)
      .innerJoin(sourceArtifacts, eq(sourceDocumentVersions.artifactId, sourceArtifacts.id))
      .where(and(
        eq(sourceDocumentVersions.sourceKind, sourceKind),
        eq(sourceDocumentVersions.sourceDocumentId, sourceDocumentId),
        eq(sourceDocumentVersions.isCurrent, true),
      )).orderBy(desc(sourceDocumentVersions.fetchedAt)).limit(1))[0];
    return row ?? null;
  });
}

export async function listSourceExtractionRuns(sourceKind: ArtifactSourceKind, sourceDocumentId: string) {
  return withDatabase((db) => db.select().from(sourceExtractionRuns).where(and(
    eq(sourceExtractionRuns.sourceKind, sourceKind),
    eq(sourceExtractionRuns.sourceDocumentId, sourceDocumentId),
  )).orderBy(desc(sourceExtractionRuns.startedAt)).limit(20));
}

export async function getSourceExtractionRun(id: string) {
  return withDatabase(async (db) => (await db.select().from(sourceExtractionRuns).where(eq(sourceExtractionRuns.id, id)).limit(1))[0] ?? null);
}

export async function markArtifactVerified(id: string, valid: boolean) {
  const result = await withDatabase(async (db) => {
    await db.update(sourceArtifacts).set({ storageStatus: valid ? "available" : "corrupt", verifiedAt: new Date() }).where(eq(sourceArtifacts.id, id));
    return true;
  });
  if (!result) throw new Error("Postgres is required to record artifact verification.");
}

export async function promoteExtractionRunRecord(id: string, userId: string) {
  const result = await withDatabase(async (db) => db.transaction(async (tx) => {
    const run = (await tx.select().from(sourceExtractionRuns).where(eq(sourceExtractionRuns.id, id)).limit(1))[0];
    if (!run) return null;
    await tx.update(sourceExtractionRuns).set({ status: "superseded" }).where(and(
      eq(sourceExtractionRuns.sourceKind, run.sourceKind),
      eq(sourceExtractionRuns.sourceDocumentId, run.sourceDocumentId),
      eq(sourceExtractionRuns.status, "promoted"),
      ne(sourceExtractionRuns.id, id),
    ));
    return (await tx.update(sourceExtractionRuns).set({ status: "promoted", promotedByUserId: userId, promotedAt: new Date() }).where(eq(sourceExtractionRuns.id, id)).returning())[0];
  }));
  if (result === null) throw new Error("Postgres is required to promote extraction runs.");
  return result;
}

export async function getArtifactIntegritySummary(): Promise<ArtifactIntegritySummary> {
  const storage = artifactStorageConfig();
  const result = await withDatabase(async (db) => {
    const [filingRows, irRows, versionRows, artifactRows, runRows] = await Promise.all([
      db.select({ id: filings.id }).from(filings),
      db.select({ id: irDocuments.id }).from(irDocuments),
      db.select().from(sourceDocumentVersions),
      db.select().from(sourceArtifacts),
      db.select().from(sourceExtractionRuns),
    ]);
    const sourceDocuments = new Set([...filingRows.map((item) => `sec:${item.id}`), ...irRows.map((item) => `ir:${item.id}`)]).size;
    const archivedDocuments = new Set(versionRows.map((item) => `${item.sourceKind}:${item.sourceDocumentId}`)).size;
    const latest = versionRows.map((item) => item.fetchedAt).sort((left, right) => right.valueOf() - left.valueOf())[0];
    return {
      sourceDocuments,
      archivedDocuments,
      immutableArtifacts: artifactRows.length,
      archivedBytes: artifactRows.reduce((total, item) => total + item.byteLength, 0),
      verifiedArtifacts: artifactRows.filter((item) => item.verifiedAt && item.storageStatus === "available").length,
      previewRuns: runRows.filter((item) => item.status === "preview").length,
      failedRuns: runRows.filter((item) => item.status === "failed").length,
      latestArchivedAt: latest?.toISOString() ?? null,
    };
  });
  const empty = { sourceDocuments: 0, archivedDocuments: 0, immutableArtifacts: 0, archivedBytes: 0, verifiedArtifacts: 0, previewRuns: 0, failedRuns: 0, latestArchivedAt: null };
  const values = result ?? empty;
  return {
    storageConfigured: storage.configured,
    storageBackend: storage.backend,
    ...values,
    coveragePercent: values.sourceDocuments ? Math.round(values.archivedDocuments / values.sourceDocuments * 100) : 0,
  };
}
