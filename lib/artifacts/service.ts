import { and, eq, inArray } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/auth/session";
import type { AuthContext } from "@/lib/auth/types";
import {
  countExtractionSnapshot,
  diffExtractionSnapshots,
  emptyExtractionDiff,
  extractionOutputHash,
  artifactStorageKey,
  sha256,
} from "@/lib/artifacts/policy";
import {
  getCurrentArchivedSource,
  getSourceExtractionRun,
  listSourceExtractionRuns,
  listArtifactsForVerification,
  markArtifactVerified,
  persistArchivedSource,
  persistExtractionRun,
  promoteExtractionRunRecord,
  type ArchivedSourceVersion,
} from "@/lib/artifacts/repository";
import { artifactStorageConfig, getArtifactObjectStore } from "@/lib/artifacts/storage";
import type { ArtifactSourceKind, ExtractionDiffSummary, ExtractionSnapshot, SourceArtifactProvenance, SourceExtractionRunItem } from "@/lib/artifacts/types";
import { getPersistedFilingDetail, persistFilingDetail } from "@/lib/db/evidence-repository";
import { getIrSourceDocument, getPersistedIrDocumentDetail, persistIrDocumentDetail } from "@/lib/db/ir-evidence-repository";
import { withDatabase } from "@/lib/db/client";
import { comparisonMemos, researchAlerts, researchEvidence, workspaceClaimEvidence, workspaceClaimStates, workspaceEvidenceReviews } from "@/lib/db/schema";
import { extractSecFilingDetail } from "@/lib/sec/extract";
import { buildCatalogOnlyIrDetail, extractIrHtmlDetail, extractIrPdfDetail } from "@/lib/ir/extract";
import type { IrDocument } from "@/lib/ir/types";
import { syncResearchEvidence } from "@/lib/research/evidence";

export { getArtifactIntegritySummary } from "@/lib/artifacts/repository";

const PARSER_VERSIONS = {
  sec: { name: "SEC deterministic HTML", version: "sec-html-v1" },
  irHtml: { name: "IR deterministic HTML", version: "ir-html-v1" },
  irPdf: { name: "IR page-aware PDF", version: "ir-pdf-v1" },
  irCatalog: { name: "IR catalog metadata", version: "ir-catalog-v1" },
} as const;

function codeVersion() {
  return process.env.GITHUB_SHA?.slice(0, 12) || process.env.SOURCE_VERSION?.trim() || "local-working-tree";
}

function parserIdentity(sourceKind: ArtifactSourceKind, contentType: string) {
  if (sourceKind === "sec") return PARSER_VERSIONS.sec;
  if (contentType.includes("pdf")) return PARSER_VERSIONS.irPdf;
  if (contentType.includes("catalog")) return PARSER_VERSIONS.irCatalog;
  return PARSER_VERSIONS.irHtml;
}

function runItem(run: Awaited<ReturnType<typeof getSourceExtractionRun>> & {}) : SourceExtractionRunItem {
  return {
    id: run.id,
    runKind: run.runKind,
    parserName: run.parserName,
    parserVersion: run.parserVersion,
    codeVersion: run.codeVersion,
    status: run.status,
    inputHash: run.inputHash,
    outputHash: run.outputHash,
    passageCount: run.passageCount,
    sectionCount: run.sectionCount,
    diffSummary: run.diffSummary as ExtractionDiffSummary,
    durationMs: run.durationMs,
    error: run.error,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt?.toISOString() ?? null,
    promotedAt: run.promotedAt?.toISOString() ?? null,
  };
}

export async function archiveSourceBytes(input: {
  sourceKind: ArtifactSourceKind;
  sourceDocumentId: string;
  companyId: string;
  sourceUrl: string;
  bytes: Uint8Array;
  contentType: string;
  fetchedAt?: string | Date;
  etag?: string | null;
  lastModified?: string | null;
}) {
  const contentHash = sha256(input.bytes);
  const storageKey = artifactStorageKey(contentHash);
  const store = getArtifactObjectStore();
  await store.put(storageKey, input.bytes, input.contentType, contentHash);
  return persistArchivedSource({
    artifactId: `artifact:${contentHash}`,
    contentHash,
    storageKey,
    storageBackend: store.backend,
    contentType: input.contentType,
    byteLength: input.bytes.byteLength,
    sourceKind: input.sourceKind,
    sourceDocumentId: input.sourceDocumentId,
    companyId: input.companyId,
    sourceUrl: input.sourceUrl,
    etag: input.etag,
    lastModified: input.lastModified,
    fetchedAt: input.fetchedAt instanceof Date ? input.fetchedAt : new Date(input.fetchedAt ?? Date.now()),
  });
}

export async function recordInitialExtraction(source: ArchivedSourceVersion, snapshot: ExtractionSnapshot, durationMs: number) {
  const parser = parserIdentity(source.version.sourceKind as ArtifactSourceKind, source.artifact.contentType);
  const count = countExtractionSnapshot(snapshot);
  return persistExtractionRun({
    source,
    runKind: "initial",
    parserName: parser.name,
    parserVersion: parser.version,
    codeVersion: codeVersion(),
    status: "promoted",
    outputHash: extractionOutputHash(snapshot),
    outputSnapshot: snapshot,
    passageCount: count.passages,
    sectionCount: count.sections,
    diffSummary: emptyExtractionDiff(snapshot),
    durationMs,
  });
}

export async function recordBackfilledExtraction(source: ArchivedSourceVersion, current: ExtractionSnapshot, extracted: ExtractionSnapshot, durationMs: number) {
  const parser = parserIdentity(source.version.sourceKind as ArtifactSourceKind, source.artifact.contentType);
  const count = countExtractionSnapshot(extracted);
  const diff = diffExtractionSnapshots(current, extracted);
  const changed = diff.addedPassages + diff.removedPassages + diff.changedPassages > 0;
  return persistExtractionRun({
    source,
    runKind: changed ? "reprocess" : "initial",
    parserName: parser.name,
    parserVersion: parser.version,
    codeVersion: codeVersion(),
    status: changed ? "preview" : "promoted",
    outputHash: extractionOutputHash(extracted),
    outputSnapshot: extracted,
    passageCount: count.passages,
    sectionCount: count.sections,
    diffSummary: diff,
    durationMs,
  });
}

export async function getSourceProvenance(sourceKind: ArtifactSourceKind, sourceDocumentId: string): Promise<SourceArtifactProvenance> {
  const source = await getCurrentArchivedSource(sourceKind, sourceDocumentId);
  const runs = await listSourceExtractionRuns(sourceKind, sourceDocumentId) ?? [];
  const config = artifactStorageConfig();
  return {
    sourceKind,
    sourceDocumentId,
    archived: Boolean(source),
    storageConfigured: config.configured,
    artifact: source ? {
      id: source.artifact.id,
      contentHash: source.artifact.contentHash,
      storageBackend: source.artifact.storageBackend,
      storageStatus: source.artifact.storageStatus,
      contentType: source.artifact.contentType,
      byteLength: source.artifact.byteLength,
      sourceUrl: source.version.sourceUrl,
      fetchedAt: source.version.fetchedAt.toISOString(),
      etag: source.version.etag,
      lastModified: source.version.lastModified,
      verifiedAt: source.artifact.verifiedAt?.toISOString() ?? null,
    } : null,
    currentExtraction: runs.find((run) => run.status === "promoted") ? runItem(runs.find((run) => run.status === "promoted")!) : null,
    previews: runs.filter((run) => run.status === "preview").map(runItem),
  };
}

export async function verifySourceArtifact(sourceKind: ArtifactSourceKind, sourceDocumentId: string, auth: AuthContext) {
  const source = await getCurrentArchivedSource(sourceKind, sourceDocumentId);
  if (!source) throw new Error("No archived source is available for this document.");
  const bytes = await getArtifactObjectStore().get(source.artifact.storageKey);
  const valid = sha256(bytes) === source.artifact.contentHash;
  await markArtifactVerified(source.artifact.id, valid);
  await recordAuditEvent(auth, {
    action: "source_artifact.verified",
    entityType: "source_artifact",
    entityId: source.artifact.id,
    summary: `${valid ? "Verified" : "Rejected"} archived ${sourceKind.toUpperCase()} source integrity.`,
    metadata: { sourceDocumentId, contentHash: source.artifact.contentHash, valid },
  });
  if (!valid) throw new Error("Artifact checksum verification failed. The stored object was marked corrupt.");
  return getSourceProvenance(sourceKind, sourceDocumentId);
}

export async function verifyArtifactIntegrityBatch(limit = 25, artifactIds?: string[]) {
  const [store, artifacts] = [getArtifactObjectStore(), await listArtifactsForVerification(limit, artifactIds)];
  let verified = 0;
  let corrupt = 0;
  const failures: Array<{ artifactId: string; message: string }> = [];
  for (const artifact of artifacts) {
    try {
      const bytes = await store.get(artifact.storageKey);
      const valid = sha256(bytes) === artifact.contentHash;
      await markArtifactVerified(artifact.id, valid);
      if (valid) verified += 1;
      else {
        corrupt += 1;
        failures.push({ artifactId: artifact.id, message: "Checksum mismatch." });
      }
    } catch (error) {
      corrupt += 1;
      await markArtifactVerified(artifact.id, false);
      failures.push({ artifactId: artifact.id, message: error instanceof Error ? error.message : "Artifact retrieval failed." });
    }
  }
  const result = { checked: artifacts.length, verified, corrupt, failures };
  if (corrupt > 0) {
    throw new ArtifactIntegrityError(result);
  }
  return result;
}

export class ArtifactIntegrityError extends Error {
  readonly result: { checked: number; verified: number; corrupt: number; failures: Array<{ artifactId: string; message: string }> };

  constructor(result: ArtifactIntegrityError["result"]) {
    super(`Source artifact verification failed for ${result.corrupt} of ${result.checked} checked artifacts.`);
    this.name = "ArtifactIntegrityError";
    this.result = result;
  }
}

export async function downloadSourceArtifact(sourceKind: ArtifactSourceKind, sourceDocumentId: string) {
  const source = await getCurrentArchivedSource(sourceKind, sourceDocumentId);
  if (!source) throw new Error("No archived source is available for this document.");
  const bytes = await getArtifactObjectStore().get(source.artifact.storageKey);
  if (sha256(bytes) !== source.artifact.contentHash) {
    await markArtifactVerified(source.artifact.id, false);
    throw new Error("Artifact checksum verification failed.");
  }
  return { bytes, artifact: source.artifact };
}

function irDocumentFromSnapshot(snapshot: ExtractionSnapshot): IrDocument {
  if (!("documentId" in snapshot)) throw new Error("The archived extraction is not an IR document.");
  return {
    id: snapshot.documentId,
    companyId: snapshot.companyId,
    companyName: snapshot.companyName,
    ticker: snapshot.ticker,
    documentType: snapshot.documentType,
    publishedAt: snapshot.publishedAt,
    title: snapshot.title,
    summary: snapshot.extraction.message,
    sourceUrl: snapshot.sourceUrl,
    sourcePageUrl: snapshot.sourcePageUrl,
    fetchedAt: snapshot.retrievedAt,
    sourceQuality: 100,
    relevanceScore: 100,
    signal: "neutral",
  };
}

async function parseArchivedSource(source: ArchivedSourceVersion, bytes: Uint8Array, current: ExtractionSnapshot) {
  const retrievedAt = source.version.fetchedAt.toISOString();
  if (source.version.sourceKind === "sec") {
    if (!("filingId" in current)) throw new Error("The current extraction is not an SEC filing.");
    return extractSecFilingDetail(new TextDecoder().decode(bytes), {
      filingId: current.filingId,
      companyId: current.companyId,
      companyName: current.companyName,
      ticker: current.ticker,
      formType: current.formType,
      filedAt: current.filedAt,
      periodOfReport: current.periodOfReport,
      accessionNumber: current.accessionNumber,
      sourceUrl: current.sourceUrl,
    }, retrievedAt);
  }
  const document = await getIrSourceDocument(source.version.sourceDocumentId) ?? irDocumentFromSnapshot(current);
  if (source.artifact.contentType.includes("catalog")) return buildCatalogOnlyIrDetail(document, retrievedAt);
  return source.artifact.contentType.includes("pdf")
    ? extractIrPdfDetail(bytes, document, retrievedAt)
    : extractIrHtmlDetail(new TextDecoder().decode(bytes), document, retrievedAt);
}

async function currentSnapshot(sourceKind: ArtifactSourceKind, sourceDocumentId: string) {
  const snapshot = sourceKind === "sec"
    ? await getPersistedFilingDetail(sourceDocumentId)
    : await getPersistedIrDocumentDetail(sourceDocumentId);
  if (!snapshot) throw new Error("The current canonical extraction is unavailable for comparison.");
  return snapshot;
}

export async function reprocessSourceArtifact(sourceKind: ArtifactSourceKind, sourceDocumentId: string, auth: AuthContext) {
  const { run } = await createSourceExtractionPreview(sourceKind, sourceDocumentId);
  await recordAuditEvent(auth, {
    action: "source_extraction.previewed",
    entityType: "source_extraction_run",
    entityId: run.id,
    summary: `Reprocessed archived ${sourceKind.toUpperCase()} source without changing canonical evidence.`,
    metadata: { sourceDocumentId, parserVersion: run.parserVersion, outputHash: run.outputHash },
  });
  return getSourceProvenance(sourceKind, sourceDocumentId);
}

export async function createSourceExtractionPreview(sourceKind: ArtifactSourceKind, sourceDocumentId: string) {
  const source = await getCurrentArchivedSource(sourceKind, sourceDocumentId);
  if (!source) throw new Error("Archive this source before requesting a parser replay.");
  const bytes = await getArtifactObjectStore().get(source.artifact.storageKey);
  if (sha256(bytes) !== source.artifact.contentHash) throw new Error("Artifact checksum verification failed before parser replay.");
  const current = await currentSnapshot(sourceKind, sourceDocumentId);
  const startedAt = Date.now();
  const preview = await parseArchivedSource(source, bytes, current);
  const count = countExtractionSnapshot(preview);
  const parser = parserIdentity(sourceKind, source.artifact.contentType);
  const run = await persistExtractionRun({
    source,
    runKind: "reprocess",
    parserName: parser.name,
    parserVersion: parser.version,
    codeVersion: codeVersion(),
    status: "preview",
    outputHash: extractionOutputHash(preview),
    outputSnapshot: preview,
    passageCount: count.passages,
    sectionCount: count.sections,
    diffSummary: diffExtractionSnapshots(current, preview),
    durationMs: Date.now() - startedAt,
  });
  return { source, current, preview, run };
}

async function capturePromotionImpact(sourceKind: ArtifactSourceKind, sourceDocumentId: string) {
  return withDatabase(async (db) => {
    const accepted = await db.select({ evidence: researchEvidence, review: workspaceEvidenceReviews })
      .from(researchEvidence)
      .innerJoin(workspaceEvidenceReviews, eq(workspaceEvidenceReviews.evidenceId, researchEvidence.id))
      .where(and(
      eq(researchEvidence.sourceKind, sourceKind),
      eq(researchEvidence.sourceDocumentId, sourceDocumentId),
      eq(workspaceEvidenceReviews.reviewStatus, "accepted"),
    ));
    const memos = await db.select().from(comparisonMemos);
    return {
      accepted: accepted.map(({ evidence, review }) => ({ workspaceId: review.workspaceId, evidenceId: evidence.id, contentHash: evidence.contentHash })),
      memos: memos.map((memo) => ({ id: memo.id, workspaceId: memo.workspaceId, evidenceIds: (memo.evidenceSnapshot as Array<{ id?: string }>).flatMap((item) => item.id ? [item.id] : []) })),
    };
  });
}

async function applyPromotionImpact(sourceKind: ArtifactSourceKind, sourceDocumentId: string, impact: NonNullable<Awaited<ReturnType<typeof capturePromotionImpact>>>) {
  await syncResearchEvidence();
  await withDatabase((database) => database.transaction(async (db) => {
    const current = await db.select().from(researchEvidence).where(and(
      eq(researchEvidence.sourceKind, sourceKind),
      eq(researchEvidence.sourceDocumentId, sourceDocumentId),
    ));
    const currentById = new Map(current.map((item) => [item.id, item]));
    const reviewIds = [...new Set(impact.accepted.map((item) => item.evidenceId))];
    const reviews = reviewIds.length ? await db.select().from(workspaceEvidenceReviews).where(inArray(workspaceEvidenceReviews.evidenceId, reviewIds)) : [];
    const reviewByScope = new Map(reviews.map((review) => [`${review.workspaceId}:${review.evidenceId}`, review]));
    const affected = impact.accepted.flatMap((item) => {
      const evidence = currentById.get(item.evidenceId);
      const review = reviewByScope.get(`${item.workspaceId}:${item.evidenceId}`);
      const removed = !evidence || (review?.reviewStatus === "rejected" && review.reviewNote?.startsWith("Superseded by the current source extraction"));
      const changed = Boolean(evidence && evidence.contentHash !== item.contentHash);
      return removed || changed ? [{ ...item, removed }] : [];
    });
    const now = new Date();
    for (const item of affected) {
      if (!item.removed) {
        await db.update(workspaceEvidenceReviews).set({
          reviewStatus: "unreviewed",
          suggestionStatus: "pending",
          reviewNote: "Parser replay changed this passage; analyst review is required again.",
          reviewedByUserId: null,
          reviewedAt: null,
          updatedAt: now,
        }).where(and(eq(workspaceEvidenceReviews.workspaceId, item.workspaceId), eq(workspaceEvidenceReviews.evidenceId, item.evidenceId)));
      }
      const claimLinks = await db.select({ claimId: workspaceClaimEvidence.claimId }).from(workspaceClaimEvidence).where(and(
        eq(workspaceClaimEvidence.workspaceId, item.workspaceId),
        eq(workspaceClaimEvidence.researchEvidenceId, item.evidenceId),
      ));
      await db.delete(workspaceClaimEvidence).where(and(eq(workspaceClaimEvidence.workspaceId, item.workspaceId), eq(workspaceClaimEvidence.researchEvidenceId, item.evidenceId)));
      await db.delete(researchAlerts).where(and(eq(researchAlerts.workspaceId, item.workspaceId), eq(researchAlerts.researchEvidenceId, item.evidenceId)));
      const claimIds = [...new Set(claimLinks.map((link) => link.claimId))];
      if (claimIds.length) await db.update(workspaceClaimStates).set({
        isStale: true,
        staleReason: "A promoted parser replay changed source evidence.",
        staleAt: now,
        updatedAt: now,
      }).where(and(eq(workspaceClaimStates.workspaceId, item.workspaceId), inArray(workspaceClaimStates.claimId, claimIds)));
    }
    const affectedByWorkspace = new Map<string, Set<string>>();
    for (const item of affected) affectedByWorkspace.set(item.workspaceId, new Set([...(affectedByWorkspace.get(item.workspaceId) ?? []), item.evidenceId]));
    const memoIds = impact.memos.filter((memo) => memo.evidenceIds.some((id) => affectedByWorkspace.get(memo.workspaceId)?.has(id))).map((memo) => memo.id);
    if (memoIds.length) await db.update(comparisonMemos).set({ status: "changes_requested", isStale: true, staleReason: "A promoted parser replay changed the cited source extraction.", staleAt: now, updatedAt: now }).where(inArray(comparisonMemos.id, memoIds));
    return { changed: affected.filter((item) => !item.removed).length, removed: affected.filter((item) => item.removed).length };
  }));
}

export async function promoteSourceExtraction(runId: string, auth: AuthContext) {
  const run = await getSourceExtractionRun(runId);
  if (!run || run.status !== "preview") throw new Error("Choose an active extraction preview to promote.");
  const snapshot = run.outputSnapshot as ExtractionSnapshot;
  const impact = await capturePromotionImpact(run.sourceKind as ArtifactSourceKind, run.sourceDocumentId);
  if (!impact) throw new Error("Postgres is required to evaluate promotion impact.");
  const persisted = run.sourceKind === "sec"
    ? await persistFilingDetail(snapshot as Extract<ExtractionSnapshot, { filingId: string }>)
    : await persistIrDocumentDetail(snapshot as Extract<ExtractionSnapshot, { documentId: string }>);
  if (!persisted) throw new Error("The promoted extraction could not be persisted.");
  await applyPromotionImpact(run.sourceKind as ArtifactSourceKind, run.sourceDocumentId, impact);
  await promoteExtractionRunRecord(runId, auth.user.id);
  await recordAuditEvent(auth, {
    action: "source_extraction.promoted",
    entityType: "source_extraction_run",
    entityId: runId,
    summary: `Promoted reviewed ${run.parserVersion} extraction into canonical evidence.`,
    metadata: { sourceKind: run.sourceKind, sourceDocumentId: run.sourceDocumentId, outputHash: run.outputHash },
  });
  return getSourceProvenance(run.sourceKind as ArtifactSourceKind, run.sourceDocumentId);
}
