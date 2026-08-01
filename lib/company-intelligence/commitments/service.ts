import { createHash } from "node:crypto";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { recordAuditEvent } from "@/lib/auth/session";
import type { AuthContext } from "@/lib/auth/types";
import { withDatabase } from "@/lib/db/client";
import {
  commitmentOutcomes,
  commitmentRevisions,
  companies,
  companyCommitments,
  companyMetrics,
  reportingPeriods,
  researchEvidence,
  users,
  workspaceCanonicalMetrics,
  workspaceEvidenceReviews,
} from "@/lib/db/schema";
import {
  calculateCommitmentVariance,
  classifyCommitmentRevision,
  compatibleOutcomeMetricKeys,
  commitmentIdentityKey,
  extractCommitmentCandidates,
} from "@/lib/company-intelligence/commitments/policy";
import type {
  CommitmentCandidate,
  CommitmentItem,
  CommitmentLedgerResponse,
  CommitmentOutcomeStatus,
  CommitmentReviewStatus,
  CommitmentRevisionItem,
  SuggestedCommitmentActual,
} from "@/lib/company-intelligence/commitments/types";

function stableId(prefix: string, value: string) {
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function candidateFromRevision(revision: typeof commitmentRevisions.$inferSelect): CommitmentCandidate {
  return {
    metricKey: "",
    label: "",
    category: "",
    scopeType: "company",
    scopeLabel: "Company total",
    statement: revision.statement,
    targetValue: Number(revision.targetValue),
    targetDisplay: revision.targetDisplay,
    targetUnit: revision.targetUnit,
    targetPeriodEnd: revision.targetPeriodEnd,
    targetDatePrecision: revision.targetDatePrecision as CommitmentCandidate["targetDatePrecision"],
    confidence: revision.confidence,
  };
}

export async function syncCommitmentCandidates(auth: AuthContext) {
  const result = await withDatabase(async (db) => {
    const evidenceRows = await db.select({ evidence: researchEvidence }).from(researchEvidence)
      .innerJoin(workspaceEvidenceReviews, and(
        eq(workspaceEvidenceReviews.evidenceId, researchEvidence.id),
        eq(workspaceEvidenceReviews.workspaceId, auth.workspace.id),
      )).where(and(
      eq(workspaceEvidenceReviews.reviewStatus, "accepted"),
      gte(researchEvidence.evidenceQualityScore, 60),
    )).orderBy(asc(researchEvidence.documentDate), asc(researchEvidence.id));
    const existingCommitments = await db.select().from(companyCommitments).where(eq(companyCommitments.workspaceId, auth.workspace.id));
    const existingRevisions = existingCommitments.length
      ? await db.select().from(commitmentRevisions).where(inArray(commitmentRevisions.commitmentId, existingCommitments.map((item) => item.id))).orderBy(asc(commitmentRevisions.sequence))
      : [];
    const commitmentsByIdentity = new Map(existingCommitments.map((item) => [`${item.companyId}:${item.commitmentKey}`, item]));
    const revisionsByCommitment = new Map<string, Array<typeof commitmentRevisions.$inferSelect>>();
    for (const revision of existingRevisions) {
      const items = revisionsByCommitment.get(revision.commitmentId) ?? [];
      items.push(revision);
      revisionsByCommitment.set(revision.commitmentId, items);
    }

    let created = 0;
    let revised = 0;
    for (const { evidence } of evidenceRows) {
      for (const candidate of extractCommitmentCandidates(evidence.excerpt)) {
        const key = commitmentIdentityKey(candidate);
        const identity = `${evidence.companyId}:${key}`;
        let commitment = commitmentsByIdentity.get(identity);
        if (!commitment) {
          const commitmentId = stableId("commitment", `${auth.workspace.id}:${evidence.companyId}:${key}:${evidence.id}`);
          commitment = {
            id: commitmentId,
            workspaceId: auth.workspace.id,
            companyId: evidence.companyId,
            sourceEvidenceId: evidence.id,
            commitmentKey: key,
            metricKey: candidate.metricKey,
            label: candidate.label,
            category: candidate.category,
            scopeType: candidate.scopeType,
            scopeLabel: candidate.scopeLabel,
            initialStatement: candidate.statement,
            reviewStatus: "proposed",
            reviewNote: null,
            reviewedByUserId: null,
            reviewedAt: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          await db.insert(companyCommitments).values(commitment).onConflictDoNothing();
          const revision = {
            id: stableId("commitment-revision", `${commitmentId}:${evidence.id}`),
            commitmentId,
            sourceEvidenceId: evidence.id,
            previousRevisionId: null,
            sequence: 1,
            revisionKind: "initiated",
            statement: candidate.statement,
            targetValue: String(candidate.targetValue),
            targetDisplay: candidate.targetDisplay,
            targetUnit: candidate.targetUnit,
            targetPeriodEnd: candidate.targetPeriodEnd,
            targetDatePrecision: candidate.targetDatePrecision,
            confidence: Math.min(candidate.confidence, evidence.evidenceQualityScore),
            validFrom: evidence.documentDate,
            reviewStatus: "proposed",
          };
          await db.insert(commitmentRevisions).values(revision).onConflictDoNothing();
          commitmentsByIdentity.set(identity, commitment);
          revisionsByCommitment.set(commitmentId, [{ ...revision, reviewNote: null, reviewedByUserId: null, reviewedAt: null, recordedAt: new Date() }]);
          created += 1;
          continue;
        }

        const revisions = revisionsByCommitment.get(commitment.id) ?? [];
        if (revisions.some((item) => item.sourceEvidenceId === evidence.id)) continue;
        const previous = [...revisions]
          .filter((item) => item.validFrom <= evidence.documentDate)
          .sort((left, right) => left.validFrom.localeCompare(right.validFrom) || left.sequence - right.sequence)
          .at(-1) ?? [...revisions].sort((left, right) => left.validFrom.localeCompare(right.validFrom) || left.sequence - right.sequence)[0];
        if (!previous) continue;
        const sequence = Math.max(...revisions.map((item) => item.sequence)) + 1;
        const revision = {
          id: stableId("commitment-revision", `${commitment.id}:${evidence.id}`),
          commitmentId: commitment.id,
          sourceEvidenceId: evidence.id,
          previousRevisionId: previous.id,
          sequence,
          revisionKind: classifyCommitmentRevision(candidateFromRevision(previous), candidate),
          statement: candidate.statement,
          targetValue: String(candidate.targetValue),
          targetDisplay: candidate.targetDisplay,
          targetUnit: candidate.targetUnit,
          targetPeriodEnd: candidate.targetPeriodEnd,
          targetDatePrecision: candidate.targetDatePrecision,
          confidence: Math.min(candidate.confidence, evidence.evidenceQualityScore),
          validFrom: evidence.documentDate,
          reviewStatus: "proposed",
        };
        await db.insert(commitmentRevisions).values(revision).onConflictDoNothing();
        revisions.push({ ...revision, reviewNote: null, reviewedByUserId: null, reviewedAt: null, recordedAt: new Date() });
        revisionsByCommitment.set(commitment.id, revisions);
        revised += 1;
      }
    }
    return { created, revised, scannedEvidence: evidenceRows.length };
  });
  if (!result) throw new Error("Postgres is required to sync commitments.");
  if (result.created > 0 || result.revised > 0) {
    await recordAuditEvent(auth, {
      action: "commitments.synced",
      entityType: "commitment_ledger",
      entityId: auth.workspace.id,
      summary: `Scanned ${result.scannedEvidence} accepted passages and added ${result.created} commitments with ${result.revised} revisions.`,
      metadata: result,
    });
  }
  return result;
}

type MetricSuggestionRow = {
  companyId: string;
  metricKey: string;
  metricId: string;
  displayValue: string;
  normalizedValue: string;
  unit: string;
  periodEnd: string;
  sourceLabel: string | null;
  scopeType: string;
  scopeLabel: string | null;
};

function suggestedActualFor(commitment: typeof companyCommitments.$inferSelect, revision: CommitmentRevisionItem, rows: MetricSuggestionRow[]): SuggestedCommitmentActual | null {
  const compatibleKeys = compatibleOutcomeMetricKeys(commitment.metricKey);
  const scopeMatches = (item: MetricSuggestionRow) => item.scopeType === commitment.scopeType
    && (commitment.scopeLabel === "Company total" || commitment.scopeLabel === "Facility or campus" || item.scopeLabel === commitment.scopeLabel);
  const candidates = rows.filter((item) =>
    item.companyId === commitment.companyId
    && compatibleKeys.includes(item.metricKey)
    && scopeMatches(item)
    && item.periodEnd >= revision.validFrom,
  );
  const targetPeriodEnd = revision.targetPeriodEnd;
  const afterTarget = targetPeriodEnd ? candidates.filter((item) => item.periodEnd >= targetPeriodEnd) : [];
  const match = afterTarget[0] ?? candidates[0];
  return match ? { ...match, normalizedValue: Number(match.normalizedValue) } : null;
}

export async function getCommitmentLedger(auth: AuthContext, companyId?: string): Promise<CommitmentLedgerResponse> {
  const result = await withDatabase(async (db) => {
    const companyRows = await db.select().from(companies).orderBy(asc(companies.name));
    const company = companyRows.find((item) => item.id === companyId) ?? companyRows[0];
    if (!company) throw new Error("No tracked company is available.");
    const commitmentRows = await db.select().from(companyCommitments).where(and(
      eq(companyCommitments.workspaceId, auth.workspace.id),
      eq(companyCommitments.companyId, company.id),
    )).orderBy(desc(companyCommitments.createdAt));
    const commitmentIds = commitmentRows.map((item) => item.id);
    const revisionRows = commitmentIds.length
      ? await db.select().from(commitmentRevisions).where(inArray(commitmentRevisions.commitmentId, commitmentIds)).orderBy(asc(commitmentRevisions.sequence))
      : [];
    const outcomeRows = commitmentIds.length
      ? await db.select().from(commitmentOutcomes).where(inArray(commitmentOutcomes.commitmentId, commitmentIds)).orderBy(desc(commitmentOutcomes.recordedAt))
      : [];
    const evidenceIds = [...new Set([...revisionRows.map((item) => item.sourceEvidenceId), ...outcomeRows.map((item) => item.sourceEvidenceId).filter(Boolean) as string[]])];
    const evidenceRows = evidenceIds.length ? await db.select().from(researchEvidence).where(inArray(researchEvidence.id, evidenceIds)) : [];
    const reviewerIds = [...new Set([
      ...commitmentRows.map((item) => item.reviewedByUserId),
      ...revisionRows.map((item) => item.reviewedByUserId),
      ...outcomeRows.map((item) => item.reviewedByUserId),
    ].filter(Boolean) as string[])];
    const reviewerRows = reviewerIds.length ? await db.select().from(users).where(inArray(users.id, reviewerIds)) : [];
    const metricRows = await db.select({
      companyId: workspaceCanonicalMetrics.companyId,
      metricKey: workspaceCanonicalMetrics.metricKey,
      metricId: companyMetrics.id,
      displayValue: companyMetrics.displayValue,
      normalizedValue: companyMetrics.normalizedValue,
      unit: companyMetrics.unit,
      periodEnd: reportingPeriods.periodEnd,
      sourceLabel: companyMetrics.sourceLabel,
      scopeType: companyMetrics.scopeType,
      scopeLabel: companyMetrics.scopeLabel,
    }).from(workspaceCanonicalMetrics)
      .innerJoin(companyMetrics, eq(workspaceCanonicalMetrics.metricId, companyMetrics.id))
      .innerJoin(reportingPeriods, eq(companyMetrics.periodId, reportingPeriods.id))
      .where(and(
        eq(workspaceCanonicalMetrics.workspaceId, auth.workspace.id),
        eq(workspaceCanonicalMetrics.companyId, company.id),
      ))
      .orderBy(desc(reportingPeriods.periodEnd));
    return { company, commitmentRows, revisionRows, outcomeRows, evidenceRows, reviewerRows, metricRows };
  });
  if (!result) throw new Error("Postgres is required for the commitments ledger.");

  const evidenceById = new Map(result.evidenceRows.map((item) => [item.id, item]));
  const reviewerById = new Map(result.reviewerRows.map((item) => [item.id, item.name]));
  const commitments: CommitmentItem[] = result.commitmentRows.flatMap((commitment) => {
    const revisions: CommitmentRevisionItem[] = result.revisionRows.filter((item) => item.commitmentId === commitment.id).map((revision) => {
      const evidence = evidenceById.get(revision.sourceEvidenceId);
      if (!evidence) return null;
      return {
        id: revision.id,
        sequence: revision.sequence,
        revisionKind: revision.revisionKind as CommitmentRevisionItem["revisionKind"],
        statement: revision.statement,
        targetValue: Number(revision.targetValue),
        targetDisplay: revision.targetDisplay,
        targetUnit: revision.targetUnit,
        targetPeriodEnd: revision.targetPeriodEnd,
        targetDatePrecision: revision.targetDatePrecision,
        confidence: revision.confidence,
        validFrom: revision.validFrom,
        recordedAt: revision.recordedAt.toISOString(),
        reviewStatus: revision.reviewStatus as CommitmentReviewStatus,
        reviewNote: revision.reviewNote,
        reviewerName: revision.reviewedByUserId ? reviewerById.get(revision.reviewedByUserId) ?? null : null,
        source: {
          evidenceId: evidence.id,
          sourceType: evidence.sourceType,
          documentTitle: evidence.documentTitle,
          documentDate: evidence.documentDate,
          sourceUrl: evidence.sourceUrl,
          pageNumber: evidence.pageNumber,
        },
      } satisfies CommitmentRevisionItem;
    }).filter((item): item is CommitmentRevisionItem => item !== null);
    const currentRevision = [...revisions]
      .filter((item) => item.reviewStatus !== "rejected")
      .sort((left, right) => left.validFrom.localeCompare(right.validFrom) || left.sequence - right.sequence)
      .at(-1) ?? revisions.at(-1);
    if (!currentRevision) return [];
    return [{
      id: commitment.id,
      companyId: commitment.companyId,
      commitmentKey: commitment.commitmentKey,
      metricKey: commitment.metricKey,
      label: commitment.label,
      category: commitment.category,
      scopeType: commitment.scopeType,
      scopeLabel: commitment.scopeLabel,
      initialStatement: commitment.initialStatement,
      reviewStatus: commitment.reviewStatus as CommitmentReviewStatus,
      reviewNote: commitment.reviewNote,
      reviewerName: commitment.reviewedByUserId ? reviewerById.get(commitment.reviewedByUserId) ?? null : null,
      createdAt: commitment.createdAt.toISOString(),
      currentRevision,
      revisions,
      outcomes: result.outcomeRows.filter((item) => item.commitmentId === commitment.id).map((outcome) => ({
        id: outcome.id,
        outcomeStatus: outcome.outcomeStatus as CommitmentOutcomeStatus,
        actualDisplay: outcome.actualDisplay,
        actualUnit: outcome.actualUnit,
        actualPeriodEnd: outcome.actualPeriodEnd,
        variancePercent: outcome.variancePercent,
        rationale: outcome.rationale,
        confidence: outcome.confidence,
        reviewerName: reviewerById.get(outcome.reviewedByUserId) ?? "Unknown reviewer",
        recordedAt: outcome.recordedAt.toISOString(),
      })),
      suggestedActual: suggestedActualFor(commitment, currentRevision, result.metricRows),
    }];
  });
  const today = new Date().toISOString().slice(0, 10);
  return {
    company: { id: result.company.id, name: result.company.name, ticker: result.company.ticker },
    summary: {
      total: commitments.length,
      proposed: commitments.filter((item) => item.reviewStatus === "proposed").length,
      accepted: commitments.filter((item) => item.reviewStatus === "accepted").length,
      changed: commitments.filter((item) => item.revisions.length > 1).length,
      reconciled: commitments.filter((item) => item.outcomes.length > 0).length,
      due: commitments.filter((item) => item.reviewStatus === "accepted" && item.currentRevision.targetPeriodEnd && item.currentRevision.targetPeriodEnd <= today && !item.outcomes.length).length,
    },
    commitments,
    systemTime: new Date().toISOString(),
  };
}

export async function reviewCommitment(id: string, status: CommitmentReviewStatus, note: string | undefined, auth: AuthContext) {
  const result = await withDatabase(async (db) => {
    const commitment = (await db.select().from(companyCommitments).where(and(eq(companyCommitments.id, id), eq(companyCommitments.workspaceId, auth.workspace.id))).limit(1))[0];
    if (!commitment) throw new Error("Commitment not found in this workspace.");
    const review = { reviewStatus: status, reviewNote: note?.trim() || null, reviewedByUserId: auth.user.id, reviewedAt: new Date() };
    await db.update(companyCommitments).set({ ...review, updatedAt: new Date() }).where(eq(companyCommitments.id, id));
    await db.update(commitmentRevisions).set(review).where(and(eq(commitmentRevisions.commitmentId, id), eq(commitmentRevisions.sequence, 1)));
    return commitment;
  });
  if (!result) throw new Error("Postgres is required to review commitments.");
  await recordAuditEvent(auth, { action: "commitment.reviewed", entityType: "company_commitment", entityId: id, summary: `${status === "accepted" ? "Accepted" : status === "rejected" ? "Rejected" : "Reset"} ${result.label} commitment.`, metadata: { status, note: note?.trim() || null } });
  return getCommitmentLedger(auth, result.companyId);
}

export async function reviewCommitmentRevision(id: string, status: CommitmentReviewStatus, note: string | undefined, auth: AuthContext) {
  const result = await withDatabase(async (db) => {
    const row = (await db.select({ revision: commitmentRevisions, commitment: companyCommitments }).from(commitmentRevisions)
      .innerJoin(companyCommitments, eq(commitmentRevisions.commitmentId, companyCommitments.id))
      .where(and(eq(commitmentRevisions.id, id), eq(companyCommitments.workspaceId, auth.workspace.id))).limit(1))[0];
    if (!row) throw new Error("Commitment revision not found in this workspace.");
    await db.update(commitmentRevisions).set({ reviewStatus: status, reviewNote: note?.trim() || null, reviewedByUserId: auth.user.id, reviewedAt: new Date() }).where(eq(commitmentRevisions.id, id));
    return row;
  });
  if (!result) throw new Error("Postgres is required to review commitment revisions.");
  await recordAuditEvent(auth, { action: "commitment_revision.reviewed", entityType: "commitment_revision", entityId: id, summary: `${status === "accepted" ? "Accepted" : status === "rejected" ? "Rejected" : "Reset"} ${result.revision.revisionKind} revision for ${result.commitment.label}.`, metadata: { status, commitmentId: result.commitment.id } });
  return getCommitmentLedger(auth, result.commitment.companyId);
}

export async function reconcileCommitment(id: string, requestedStatus: CommitmentOutcomeStatus | undefined, auth: AuthContext) {
  const owner = await withDatabase(async (db) => (await db.select().from(companyCommitments).where(and(eq(companyCommitments.id, id), eq(companyCommitments.workspaceId, auth.workspace.id))).limit(1))[0]);
  if (!owner) throw new Error("Commitment not found in this workspace.");
  const item = (await getCommitmentLedger(auth, owner.companyId)).commitments.find((commitment) => commitment.id === id);
  if (!item || item.reviewStatus !== "accepted") throw new Error("Only accepted commitments can be reconciled.");
  const actual = item.suggestedActual;
  if (!actual) throw new Error("No compatible canonical metric is available for reconciliation.");
  const target = item.currentRevision.targetValue;
  const variancePercent = actual.unit === item.currentRevision.targetUnit ? calculateCommitmentVariance(target, actual.normalizedValue) : null;
  const inferredStatus: CommitmentOutcomeStatus = actual.unit !== item.currentRevision.targetUnit
    ? "not-comparable"
    : actual.normalizedValue >= target ? "achieved" : actual.normalizedValue >= target * 0.75 ? "partial" : "missed";
  const outcomeStatus = requestedStatus ?? inferredStatus;
  const rationale = actual.unit === item.currentRevision.targetUnit
    ? `${actual.displayValue} reported for ${actual.periodEnd} versus ${item.currentRevision.targetDisplay} committed${variancePercent === null ? "" : ` (${variancePercent >= 0 ? "+" : ""}${variancePercent}%)`}.`
    : `The canonical actual uses ${actual.unit}, which is not comparable with the committed ${item.currentRevision.targetUnit}.`;
  await withDatabase(async (db) => {
    const values = {
      id: `commitment-outcome:${crypto.randomUUID()}`,
      commitmentId: item!.id,
      metricId: actual.metricId,
      outcomeStatus,
      actualValue: String(actual.normalizedValue),
      actualDisplay: actual.displayValue,
      actualUnit: actual.unit,
      actualPeriodEnd: actual.periodEnd,
      variancePercent,
      rationale,
      confidence: actual.unit === item!.currentRevision.targetUnit ? 92 : 45,
      reviewedByUserId: auth.user.id,
      recordedAt: new Date(),
    };
    await db.insert(commitmentOutcomes).values(values).onConflictDoUpdate({
      target: [commitmentOutcomes.commitmentId, commitmentOutcomes.metricId],
      set: { ...values, id: undefined },
    });
  });
  await recordAuditEvent(auth, { action: "commitment.reconciled", entityType: "company_commitment", entityId: item.id, summary: `Reconciled ${item.label} as ${outcomeStatus} using ${actual.displayValue}.`, metadata: { metricId: actual.metricId, outcomeStatus, variancePercent } });
  return getCommitmentLedger(auth, item.companyId);
}
