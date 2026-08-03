import { and, desc, eq, gte, ilike, inArray, lt, lte, notInArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import {
  companies,
  comparisonMemos,
  evidencePassages,
  filings,
  filingSections,
  irDocuments,
  irDocumentSections,
  irEvidencePassages,
  researchEvidence,
  researchClaims,
  researchAlerts,
  users,
  workspaceClaimEvidence,
  workspaceClaimStates,
  workspaceEvidenceReviews,
} from "@/lib/db/schema";
import { classifyAlertCategory } from "@/lib/alerts/generate";
import { assessEvidenceQuality } from "@/lib/research/quality";
import { decodeEvidenceCursor, encodeEvidenceCursor } from "@/lib/research/evidence-pagination";
import type { EvidenceFilters, EvidenceReviewStatus, EvidenceSuggestionStatus, ResearchEvidenceItem } from "@/lib/research/types";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";

const TOPIC_RULES: Array<[string, RegExp]> = [
  ["Power & capacity", /power|energy|electric|megawatt|gigawatt|capacity|campus|data cent(?:er|re)/i],
  ["Customers & demand", /customer|contract|backlog|demand|revenue|reservation|pipeline/i],
  ["Financing & liquidity", /financ|liquidity|debt|capital|cash|credit|convertible|lease/i],
  ["Compute & accelerators", /gpu|accelerator|nvidia|amd|compute|cluster|server|rack/i],
  ["Networking", /network|ethernet|infiniband|optical|switch|fabric/i],
  ["Operations & execution", /construction|delivery|deploy|operation|utilization|supply|delay/i],
  ["Competition & strategy", /competition|competitor|strategy|market|hyperscal|differentiat/i],
  ["Risk factors", /risk|uncertain|adverse|depend|concentrat|could harm|may not/i],
];

function linkedEvidenceScore(quality: number, confidence: number, documentDate: string) {
  const ageDays = Math.max(0, (Date.now() - new Date(`${documentDate}T00:00:00Z`).valueOf()) / 86_400_000);
  const qualityScore = quality >= 90 ? 10 : quality >= 80 ? 8 : quality >= 70 ? 6 : 4;
  const recencyScore = qualityScore * (ageDays <= 180 ? 1 : ageDays <= 365 ? 0.8 : 0.55);
  return Math.max(2, Math.round(recencyScore * Math.max(50, confidence) / 100));
}

function topicFor(...parts: string[]) {
  const value = parts.join(" ");
  return TOPIC_RULES.find(([, pattern]) => pattern.test(value))?.[0] ?? "Company developments";
}

function qualityScore(quality: string, sourceKind: "sec" | "ir") {
  const base = quality === "high" ? 92 : quality === "medium" ? 78 : 60;
  return sourceKind === "sec" ? Math.min(100, base + 3) : base;
}

function qualityFields(input: { companyId: string; excerpt: string; topic: string; sectionTitle: string; sourceType: string; sourceQuality: number }) {
  const assessment = assessEvidenceQuality(input);
  return {
    evidenceQualityScore: assessment.evidenceQualityScore,
    materialityScore: assessment.materialityScore,
    specificityScore: assessment.specificityScore,
    relevanceScore: assessment.relevanceScore,
    boilerplateRisk: assessment.boilerplateRisk,
    qualityReasons: assessment.qualityReasons,
    duplicateGroupId: assessment.duplicateGroupId,
    suggestedClaimId: assessment.suggestion ? `${input.companyId}:${assessment.suggestion.claimKind}` : null,
    suggestedImpact: assessment.suggestion?.impact ?? null,
    suggestionConfidence: assessment.suggestion?.confidence ?? 0,
    suggestionRationale: assessment.suggestion?.rationale ?? null,
    qualityScoredAt: new Date(),
  };
}

export function isResearchGradeExcerpt(value: string) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length < 18) return false;
  return ![
    /pursuant to the requirements of the securities exchange act/i,
    /has duly caused this report to be signed/i,
    /furnished as exhibit\s+\d/i,
    /incorporated (?:herein )?by reference/i,
    /^\s*\d{1,3}\.\d\s+(?:press release|financial statements|exhibit)/i,
    /^\s*\d{1,3}(?:\.\d+)?\**\s+(?:agreement|credit agreement|certificates?|form of|incremental|press release|financial statements?|exhibit)/i,
    /^\s*\d{1,3}(?:\.\d+)?\W+indenture, dated as of/i,
    /^form of certificates? representing/i,
    /\bcopy of .* (?:is|are|will be) (?:filed as|attached as) an? exhibit\b/i,
    /\bcopy of .* (?:is|are|will be) attached as exhibit\b/i,
    /shall not constitute an offer to sell or the solicitation of (?:(?:an|any) )?offer to buy/i,
    /the offer and sale of .* (?:is|are) and will be made in reliance upon .* exemption from registration/i,
    /contains customary representations, warranties, covenants, indemnities and termination rights/i,
    /^(?:indenture|agreement), dated as of .* between .* and .* as (?:trustee|agent)/i,
    /contains ["“”]?forward-looking statements["“”]? within the meaning of/i,
    /^the following table summarizes our results of operation/i,
    /the information (?:contained|included) in this (?:report|item) .* shall not be deemed/i,
  ].some((pattern) => pattern.test(value));
}

export function isResearchGradeSecPassage(value: string, category: string, sectionTitle: string) {
  if (/filing overview/i.test(category)) return false;
  if (/^(?:filing overview|signatures?|exhibits?)$/i.test(sectionTitle.trim())) return false;
  return isResearchGradeExcerpt(value);
}

function hash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return `${(result >>> 0).toString(16)}:${value.length}`;
}

export async function syncResearchEvidence() {
  const result = await withDatabase(async (db) => {
    const secRows = await db.select({
      passage: evidencePassages,
      section: filingSections,
      document: filings,
    }).from(evidencePassages)
      .innerJoin(filingSections, eq(evidencePassages.sectionId, filingSections.id))
      .innerJoin(filings, eq(filingSections.filingId, filings.id));

    const irRows = await db.select({
      passage: irEvidencePassages,
      section: irDocumentSections,
      document: irDocuments,
    }).from(irEvidencePassages)
      .innerJoin(irDocumentSections, eq(irEvidencePassages.sectionId, irDocumentSections.id))
      .innerJoin(irDocuments, eq(irDocumentSections.documentId, irDocuments.id));

    const researchGradeSecRows = secRows.filter(({ passage, section }) => isResearchGradeSecPassage(passage.text, section.category, section.title));
    const researchGradeIrRows = irRows.filter(({ passage }) => isResearchGradeExcerpt(passage.text));

    for (const { passage, section, document } of researchGradeSecRows) {
      const topic = topicFor(section.category, section.title, passage.text);
      const sourceQuality = qualityScore(document.extractionQuality, "sec");
      const assessment = qualityFields({ companyId: document.companyId, excerpt: passage.text, topic, sectionTitle: section.title, sourceType: `SEC ${document.formType}`, sourceQuality });
      await db.insert(researchEvidence).values({
        id: `research:sec:${passage.id}`,
        companyId: document.companyId,
        sourceKind: "sec",
        sourceDocumentId: document.id,
        sourcePassageId: passage.id,
        sourceType: `SEC ${document.formType}`,
        documentTitle: document.documentTitle,
        documentDate: document.filedAt,
        sectionTitle: section.title,
        topic,
        excerpt: passage.text,
        sourceUrl: document.sourceUrl,
        pageNumber: null,
        sourceQuality,
        contentHash: hash(passage.text),
        ...assessment,
      }).onConflictDoUpdate({
        target: [researchEvidence.sourceKind, researchEvidence.sourcePassageId],
        set: {
          documentTitle: document.documentTitle,
          documentDate: document.filedAt,
          sectionTitle: section.title,
          topic,
          excerpt: passage.text,
          sourceUrl: document.sourceUrl,
          sourceQuality,
          contentHash: hash(passage.text),
          ...assessment,
          suggestedClaimId: sql`CASE WHEN ${researchEvidence.suggestionStatus} = 'pending' THEN excluded.suggested_claim_id ELSE ${researchEvidence.suggestedClaimId} END`,
          suggestedImpact: sql`CASE WHEN ${researchEvidence.suggestionStatus} = 'pending' THEN excluded.suggested_impact ELSE ${researchEvidence.suggestedImpact} END`,
          suggestionConfidence: sql`CASE WHEN ${researchEvidence.suggestionStatus} = 'pending' THEN excluded.suggestion_confidence ELSE ${researchEvidence.suggestionConfidence} END`,
          suggestionRationale: sql`CASE WHEN ${researchEvidence.suggestionStatus} = 'pending' THEN excluded.suggestion_rationale ELSE ${researchEvidence.suggestionRationale} END`,
          updatedAt: new Date(),
        },
      });
    }

    for (const { passage, section, document } of researchGradeIrRows) {
      const topic = topicFor(section.category, section.title, passage.text);
      const sourceQuality = qualityScore(document.extractionQuality, "ir");
      const assessment = qualityFields({ companyId: document.companyId, excerpt: passage.text, topic, sectionTitle: section.title, sourceType: document.documentType, sourceQuality });
      await db.insert(researchEvidence).values({
        id: `research:ir:${passage.id}`,
        companyId: document.companyId,
        sourceKind: "ir",
        sourceDocumentId: document.id,
        sourcePassageId: passage.id,
        sourceType: document.documentType,
        documentTitle: document.title,
        documentDate: document.publishedAt,
        sectionTitle: section.title,
        topic,
        excerpt: passage.text,
        sourceUrl: document.sourceUrl,
        pageNumber: passage.pageNumber,
        sourceQuality,
        contentHash: hash(passage.text),
        ...assessment,
      }).onConflictDoUpdate({
        target: [researchEvidence.sourceKind, researchEvidence.sourcePassageId],
        set: {
          documentTitle: document.title,
          documentDate: document.publishedAt,
          sectionTitle: section.title,
          topic,
          excerpt: passage.text,
          sourceUrl: document.sourceUrl,
          pageNumber: passage.pageNumber,
          sourceQuality,
          contentHash: hash(passage.text),
          ...assessment,
          suggestedClaimId: sql`CASE WHEN ${researchEvidence.suggestionStatus} = 'pending' THEN excluded.suggested_claim_id ELSE ${researchEvidence.suggestedClaimId} END`,
          suggestedImpact: sql`CASE WHEN ${researchEvidence.suggestionStatus} = 'pending' THEN excluded.suggested_impact ELSE ${researchEvidence.suggestedImpact} END`,
          suggestionConfidence: sql`CASE WHEN ${researchEvidence.suggestionStatus} = 'pending' THEN excluded.suggestion_confidence ELSE ${researchEvidence.suggestionConfidence} END`,
          suggestionRationale: sql`CASE WHEN ${researchEvidence.suggestionStatus} = 'pending' THEN excluded.suggestion_rationale ELSE ${researchEvidence.suggestionRationale} END`,
          updatedAt: new Date(),
        },
      });
    }

    const secPassageIds = researchGradeSecRows.map(({ passage }) => passage.id);
    const irPassageIds = researchGradeIrRows.map(({ passage }) => passage.id);
    const reconcileMissingPassages = async (sourceKind: "sec" | "ir", activePassageIds: string[]) => {
      const missing = activePassageIds.length
        ? and(eq(researchEvidence.sourceKind, sourceKind), notInArray(researchEvidence.sourcePassageId, activePassageIds))
        : eq(researchEvidence.sourceKind, sourceKind);
      await db.update(workspaceEvidenceReviews).set({
        reviewStatus: "rejected",
        suggestionStatus: "rejected",
        reviewNote: "Superseded by the current source extraction; retained for audit history.",
        updatedAt: new Date(),
      }).where(and(
        eq(workspaceEvidenceReviews.reviewStatus, "accepted"),
        sql`EXISTS (SELECT 1 FROM research_evidence WHERE research_evidence.id = ${workspaceEvidenceReviews.evidenceId} AND ${missing})`,
      ));
      await db.delete(researchEvidence).where(and(
        missing,
        sql`NOT EXISTS (SELECT 1 FROM workspace_evidence_reviews wer WHERE wer.evidence_id = ${researchEvidence.id})`,
        sql`NOT EXISTS (SELECT 1 FROM company_commitments WHERE company_commitments.source_evidence_id = ${researchEvidence.id})`,
        sql`NOT EXISTS (SELECT 1 FROM commitment_revisions WHERE commitment_revisions.source_evidence_id = ${researchEvidence.id})`,
      ));
    };
    await reconcileMissingPassages("sec", secPassageIds);
    await reconcileMissingPassages("ir", irPassageIds);

    const evidenceRows = await db.select().from(researchEvidence);
    const duplicateCounts = new Map<string, number>();
    for (const item of evidenceRows) if (item.duplicateGroupId) duplicateCounts.set(item.duplicateGroupId, (duplicateCounts.get(item.duplicateGroupId) ?? 0) + 1);
    for (const [groupId, duplicateCount] of duplicateCounts) {
      await db.update(researchEvidence).set({ duplicateCount }).where(eq(researchEvidence.duplicateGroupId, groupId));
    }
    return { sec: researchGradeSecRows.length, ir: researchGradeIrRows.length };
  });
  if (!result) throw new Error("Postgres is required for the research evidence workspace.");
  return result;
}

function toItem(row: {
  evidence: typeof researchEvidence.$inferSelect;
  company: typeof companies.$inferSelect;
  review?: typeof workspaceEvidenceReviews.$inferSelect | null;
  reviewer?: typeof users.$inferSelect | null;
}, claimTitle?: string | null): ResearchEvidenceItem {
  const review = row.review;
  return {
    id: row.evidence.id,
    companyId: row.company.id,
    companyName: row.company.name,
    ticker: row.company.ticker,
    sourceKind: row.evidence.sourceKind as ResearchEvidenceItem["sourceKind"],
    sourceDocumentId: row.evidence.sourceDocumentId,
    sourcePassageId: row.evidence.sourcePassageId,
    sourceType: row.evidence.sourceType,
    documentTitle: row.evidence.documentTitle,
    documentDate: row.evidence.documentDate,
    sectionTitle: row.evidence.sectionTitle,
    topic: row.evidence.topic,
    excerpt: row.evidence.excerpt,
    sourceUrl: row.evidence.sourceUrl,
    pageNumber: row.evidence.pageNumber,
    sourceQuality: row.evidence.sourceQuality,
    contentHash: row.evidence.contentHash,
    evidenceQualityScore: row.evidence.evidenceQualityScore,
    materialityScore: row.evidence.materialityScore,
    specificityScore: row.evidence.specificityScore,
    relevanceScore: row.evidence.relevanceScore,
    boilerplateRisk: row.evidence.boilerplateRisk,
    qualityReasons: row.evidence.qualityReasons as string[],
    duplicateGroupId: row.evidence.duplicateGroupId,
    duplicateCount: row.evidence.duplicateCount,
    suggestedClaimId: review?.suggestedClaimId ?? row.evidence.suggestedClaimId,
    suggestedClaimTitle: claimTitle ?? null,
    suggestedImpact: (review?.suggestedImpact ?? row.evidence.suggestedImpact) as ResearchEvidenceItem["suggestedImpact"],
    suggestionConfidence: row.evidence.suggestionConfidence,
    suggestionRationale: row.evidence.suggestionRationale,
    suggestionStatus: (review?.suggestionStatus ?? "pending") as EvidenceSuggestionStatus,
    qualityScoredAt: row.evidence.qualityScoredAt?.toISOString() ?? null,
    reviewStatus: (review?.reviewStatus ?? "unreviewed") as EvidenceReviewStatus,
    reviewNote: review?.reviewNote ?? null,
    reviewedAt: review?.reviewedAt?.toISOString() ?? null,
    reviewedBy: row.reviewer ? { id: row.reviewer.id, name: row.reviewer.name, email: row.reviewer.email } : null,
  };
}

export async function listResearchEvidence(workspaceId: string, filters: EvidenceFilters = {}) {
  const result = await withDatabase(async (db) => {
    const reviewStatus = sql<string>`coalesce(${workspaceEvidenceReviews.reviewStatus}, 'unreviewed')`;
    const suggestionStatus = sql<string>`coalesce(${workspaceEvidenceReviews.suggestionStatus}, 'pending')`;
    const suggestedClaimId = sql<string | null>`coalesce(${workspaceEvidenceReviews.suggestedClaimId}, ${researchEvidence.suggestedClaimId})`;
    const conditions: SQL[] = [];
    const query = filters.query?.trim();
    if (query) conditions.push(or(
      ilike(companies.name, `%${query}%`), ilike(companies.ticker, `%${query}%`),
      ilike(researchEvidence.documentTitle, `%${query}%`), ilike(researchEvidence.sectionTitle, `%${query}%`),
      ilike(researchEvidence.topic, `%${query}%`), ilike(researchEvidence.excerpt, `%${query}%`),
    )!);
    if (filters.companyId) conditions.push(eq(researchEvidence.companyId, filters.companyId));
    if (filters.topic) conditions.push(eq(researchEvidence.topic, filters.topic));
    if (filters.sourceKind) conditions.push(eq(researchEvidence.sourceKind, filters.sourceKind));
    if (filters.reviewStatus) conditions.push(sql`${reviewStatus} = ${filters.reviewStatus}`);
    if (filters.dateFrom) conditions.push(gte(researchEvidence.documentDate, filters.dateFrom));
    if (filters.triage === "decision-ready") conditions.push(and(
      sql`${reviewStatus} = 'unreviewed'`,
      gte(researchEvidence.evidenceQualityScore, 60),
      lt(researchEvidence.boilerplateRisk, 60),
      sql`(${researchEvidence.duplicateGroupId} IS NULL OR ${researchEvidence.id} = (
        SELECT candidate.id FROM research_evidence candidate
        WHERE candidate.duplicate_group_id = ${researchEvidence.duplicateGroupId}
        ORDER BY candidate.evidence_quality_score DESC, candidate.document_date DESC, candidate.id DESC LIMIT 1
      ))`,
    )!);
    if (filters.triage === "review") conditions.push(or(
      sql`${reviewStatus} = 'unreviewed'`,
      and(sql`${suggestedClaimId} IS NOT NULL`, sql`${suggestionStatus} = 'pending'`),
    )!);
    if (filters.triage === "high-value") conditions.push(and(gte(researchEvidence.evidenceQualityScore, 70), lt(researchEvidence.boilerplateRisk, 40))!);
    if (filters.triage === "boilerplate") conditions.push(gte(researchEvidence.boilerplateRisk, 60));
    if (filters.triage === "duplicates") conditions.push(gte(researchEvidence.duplicateCount, 2));

    const cursor = decodeEvidenceCursor(filters.cursor);
    const pageConditions = [...conditions];
    if (cursor) pageConditions.push(or(
      lt(researchEvidence.evidenceQualityScore, cursor.quality),
      and(eq(researchEvidence.evidenceQualityScore, cursor.quality), lt(researchEvidence.documentDate, cursor.date)),
      and(eq(researchEvidence.evidenceQualityScore, cursor.quality), eq(researchEvidence.documentDate, cursor.date), lt(researchEvidence.id, cursor.id)),
    )!);
    const limit = Math.max(1, Math.min(100, filters.limit ?? 50));
    const rows = await db.select({ evidence: researchEvidence, company: companies, review: workspaceEvidenceReviews, reviewer: users })
      .from(researchEvidence)
      .innerJoin(companies, eq(researchEvidence.companyId, companies.id))
      .leftJoin(workspaceEvidenceReviews, and(
        eq(workspaceEvidenceReviews.evidenceId, researchEvidence.id),
        eq(workspaceEvidenceReviews.workspaceId, workspaceId),
      ))
      .leftJoin(users, eq(workspaceEvidenceReviews.reviewedByUserId, users.id))
      .where(and(...pageConditions))
      .orderBy(desc(researchEvidence.evidenceQualityScore), desc(researchEvidence.documentDate), desc(researchEvidence.id))
      .limit(limit + 1);
    const claimRows = await db.select().from(researchClaims);
    const claimsById = new Map(claimRows.map((claim) => [claim.id, claim.title]));
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map((row) => {
      const claimId = row.review?.suggestedClaimId ?? row.evidence.suggestedClaimId;
      return toItem(row, claimId ? claimsById.get(claimId) : null);
    });
    const last = pageRows.at(-1)?.evidence;
    const nextCursor = rows.length > limit && last
      ? encodeEvidenceCursor({ quality: last.evidenceQualityScore, date: last.documentDate, id: last.id })
      : null;

    const [{ count: total = 0 } = { count: 0 }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(researchEvidence)
      .innerJoin(companies, eq(researchEvidence.companyId, companies.id))
      .leftJoin(workspaceEvidenceReviews, and(eq(workspaceEvidenceReviews.evidenceId, researchEvidence.id), eq(workspaceEvidenceReviews.workspaceId, workspaceId)))
      .where(and(...conditions));
    const summaryRows = await db.select({ status: reviewStatus, count: sql<number>`count(*)::int` })
      .from(researchEvidence)
      .leftJoin(workspaceEvidenceReviews, and(eq(workspaceEvidenceReviews.evidenceId, researchEvidence.id), eq(workspaceEvidenceReviews.workspaceId, workspaceId)))
      .groupBy(reviewStatus);
    const summary = { unreviewed: 0, accepted: 0, rejected: 0 };
    for (const row of summaryRows) if (row.status in summary) summary[row.status as EvidenceReviewStatus] = row.count;
    const companyCounts = await db.select({ id: companies.id, name: companies.name, ticker: companies.ticker, evidenceCount: sql<number>`count(*)::int` })
      .from(researchEvidence).innerJoin(companies, eq(researchEvidence.companyId, companies.id))
      .groupBy(companies.id, companies.name, companies.ticker).orderBy(desc(sql`count(*)`));
    const topicCounts = await db.select({ name: researchEvidence.topic, evidenceCount: sql<number>`count(*)::int` })
      .from(researchEvidence).groupBy(researchEvidence.topic).orderBy(desc(sql`count(*)`));
    const [quality = { highValue: 0, boilerplateRisk: 0, pendingSuggestions: 0, duplicatePassages: 0 }] = await db.select({
      highValue: sql<number>`count(*) FILTER (WHERE ${researchEvidence.evidenceQualityScore} >= 70 AND ${researchEvidence.boilerplateRisk} < 40)::int`,
      boilerplateRisk: sql<number>`count(*) FILTER (WHERE ${researchEvidence.boilerplateRisk} >= 60)::int`,
      pendingSuggestions: sql<number>`count(*) FILTER (WHERE ${suggestedClaimId} IS NOT NULL AND ${suggestionStatus} = 'pending')::int`,
      duplicatePassages: sql<number>`count(*) FILTER (WHERE ${researchEvidence.duplicateCount} > 1)::int`,
    }).from(researchEvidence)
      .leftJoin(workspaceEvidenceReviews, and(eq(workspaceEvidenceReviews.evidenceId, researchEvidence.id), eq(workspaceEvidenceReviews.workspaceId, workspaceId)));
    return {
      items,
      nextCursor,
      total,
      summary,
      companies: companyCounts,
      topics: topicCounts,
      claims: claimRows.map((claim) => ({ id: claim.id, companyId: claim.companyId, title: claim.title, kind: claim.kind })),
      qualitySummary: quality,
    };
  });
  if (!result) throw new Error("Postgres is required for the research evidence workspace.");
  return result;
}

export async function updateEvidenceReview(ids: string[], status: EvidenceReviewStatus, note: string | undefined, suggestion: { status: EvidenceSuggestionStatus; claimId?: string; impact?: ResearchEvidenceItem["suggestedImpact"] } | undefined, auth: AuthContext) {
  if (!ids.length) return 0;
  const result = await withDatabase((database) => database.transaction(async (db) => {
    const existing = await db.select().from(researchEvidence).where(inArray(researchEvidence.id, ids));
    const existingLinks = await db.select().from(workspaceClaimEvidence).where(and(
      eq(workspaceClaimEvidence.workspaceId, auth.workspace.id),
      inArray(workspaceClaimEvidence.researchEvidenceId, ids),
    ));
    const affectedClaimIds = new Set(existingLinks.map((item) => item.claimId));
    await db.delete(workspaceClaimEvidence).where(and(
      eq(workspaceClaimEvidence.workspaceId, auth.workspace.id),
      inArray(workspaceClaimEvidence.researchEvidenceId, ids),
    ));
    await db.delete(researchAlerts).where(and(
      eq(researchAlerts.workspaceId, auth.workspace.id),
      eq(researchAlerts.alertType, "claim_impact"),
      inArray(researchAlerts.researchEvidenceId, ids),
    ));
    const now = new Date();
    for (const item of existing) {
      const decision = {
        reviewStatus: status,
        reviewNote: note?.trim() || null,
        reviewedByUserId: auth.user.id,
        reviewedAt: now,
        updatedAt: now,
        ...(suggestion ? {
          suggestionStatus: suggestion.status,
          ...(suggestion.claimId ? { suggestedClaimId: suggestion.claimId } : {}),
          ...(suggestion.impact ? { suggestedImpact: suggestion.impact } : {}),
        } : status === "rejected" ? { suggestionStatus: "rejected" } : {}),
      };
      await db.insert(workspaceEvidenceReviews).values({
        id: `${auth.workspace.id}:evidence-review:${item.id}`,
        workspaceId: auth.workspace.id,
        evidenceId: item.id,
        ...decision,
      }).onConflictDoUpdate({
        target: [workspaceEvidenceReviews.workspaceId, workspaceEvidenceReviews.evidenceId],
        set: decision,
      });

      if (status === "accepted" && suggestion?.status === "accepted" && suggestion.claimId && suggestion.impact) {
        const claim = (await db.select().from(researchClaims).where(and(
          eq(researchClaims.id, suggestion.claimId),
          eq(researchClaims.companyId, item.companyId),
        )).limit(1))[0];
        if (!claim) throw new Error("The selected thesis does not belong to this evidence company.");
        const impact = suggestion.impact;
        const base = linkedEvidenceScore(item.evidenceQualityScore || item.sourceQuality, item.suggestionConfidence, item.documentDate);
        const impactScore = impact === "supports" ? base : impact === "weakens" ? -base : 0;
        const rationale = item.suggestionRationale ?? `Analyst-approved ${impact} link to ${claim.title}.`;
        await db.insert(workspaceClaimEvidence).values({
          id: `${auth.workspace.id}:claim-evidence:${claim.id}:${item.id}`,
          workspaceId: auth.workspace.id,
          claimId: claim.id,
          researchEvidenceId: item.id,
          impact,
          impactScore,
          rationale,
          createdByUserId: auth.user.id,
        }).onConflictDoUpdate({
          target: [workspaceClaimEvidence.workspaceId, workspaceClaimEvidence.claimId, workspaceClaimEvidence.researchEvidenceId],
          set: { impact, impactScore, rationale, createdByUserId: auth.user.id, updatedAt: now },
        });
        if (Math.abs(impactScore) >= 6) {
          const category = classifyAlertCategory(`${item.topic} ${item.sectionTitle} ${item.excerpt}`);
          await db.insert(researchAlerts).values({
            id: `workspace-claim-alert:${auth.workspace.id}:${claim.id}:${item.id}`,
            workspaceId: auth.workspace.id,
            companyId: item.companyId,
            claimId: claim.id,
            researchEvidenceId: item.id,
            alertType: "claim_impact",
            category,
            significance: Math.abs(impactScore) >= 9 ? "high" : "medium",
            impact: impact === "supports" ? "strengthens" : impact === "weakens" ? "weakens" : "watch",
            title: `${claim.title} ${impact}`,
            summary: `${item.documentTitle}: ${item.excerpt.slice(0, 240)}`,
          }).onConflictDoUpdate({
            target: [researchAlerts.workspaceId, researchAlerts.claimId, researchAlerts.researchEvidenceId],
            set: { category, significance: Math.abs(impactScore) >= 9 ? "high" : "medium", impact: impact === "supports" ? "strengthens" : impact === "weakens" ? "weakens" : "watch", title: `${claim.title} ${impact}`, summary: `${item.documentTitle}: ${item.excerpt.slice(0, 240)}`, updatedAt: now },
          });
        }
        affectedClaimIds.add(claim.id);
      }
    }

    for (const claimId of affectedClaimIds) {
      const claim = (await db.select().from(researchClaims).where(eq(researchClaims.id, claimId)).limit(1))[0];
      if (!claim) continue;
      const links = await db.select({ impactScore: workspaceClaimEvidence.impactScore }).from(workspaceClaimEvidence).where(and(
        eq(workspaceClaimEvidence.workspaceId, auth.workspace.id),
        eq(workspaceClaimEvidence.claimId, claimId),
      ));
      const supportScore = Math.max(10, Math.min(90, claim.supportScore + links.reduce((sum, link) => sum + link.impactScore, 0)));
      await db.insert(workspaceClaimStates).values({
        id: `${auth.workspace.id}:claim-state:${claimId}`,
        workspaceId: auth.workspace.id,
        claimId,
        supportScore,
        isStale: false,
        staleReason: null,
        staleAt: null,
        createdByUserId: auth.user.id,
      }).onConflictDoUpdate({
        target: [workspaceClaimStates.workspaceId, workspaceClaimStates.claimId],
        set: { supportScore, isStale: false, staleReason: null, staleAt: null, updatedAt: now },
      });
    }

    let staleMemos = 0;
    const memos = await db.select().from(comparisonMemos).where(eq(comparisonMemos.workspaceId, auth.workspace.id));
    const idSet = new Set(ids);
    for (const memo of memos) {
      const snapshot = memo.evidenceSnapshot as Array<{ id?: string }>;
      if (!snapshot.some((item) => item.id && idSet.has(item.id))) continue;
      await db.update(comparisonMemos).set({ status: "changes_requested", isStale: true, staleReason: "A cited evidence passage was re-reviewed. Regenerate to use the current approved packet.", staleAt: new Date(), updatedAt: new Date() }).where(eq(comparisonMemos.id, memo.id));
      staleMemos += 1;
    }
    return { updated: existing.length, staleMemos, staleClaims: affectedClaimIds.size };
  }));
  if (result === null) throw new Error("Postgres is required for evidence review.");
  await recordAuditEvent(auth, { action: "evidence.reviewed", entityType: "research_evidence", entityId: ids[0], summary: `${status === "accepted" ? "Accepted" : status === "rejected" ? "Rejected" : "Reset"} ${result.updated} evidence passage${result.updated === 1 ? "" : "s"}.`, metadata: { evidenceIds: ids, status, suggestionStatus: suggestion?.status ?? null } });
  return result;
}

export async function getAcceptedEvidence(workspaceId: string, companyIds: string[], topic?: string, filters?: {
  sourceKinds?: Array<"sec" | "ir">;
  dateFrom?: string;
  dateTo?: string;
  knownAt?: string;
}) {
  const result = await withDatabase(async (db) => {
    const conditions = [eq(workspaceEvidenceReviews.workspaceId, workspaceId), eq(workspaceEvidenceReviews.reviewStatus, "accepted"), gte(researchEvidence.evidenceQualityScore, 45), lt(researchEvidence.boilerplateRisk, 60), inArray(researchEvidence.companyId, companyIds)];
    if (topic && topic !== "All topics") conditions.push(eq(researchEvidence.topic, topic));
    if (filters?.sourceKinds?.length) conditions.push(inArray(researchEvidence.sourceKind, filters.sourceKinds));
    if (filters?.dateFrom) conditions.push(gte(researchEvidence.documentDate, filters.dateFrom));
    if (filters?.dateTo) conditions.push(lte(researchEvidence.documentDate, filters.dateTo));
    if (filters?.knownAt) {
      const knownAt = new Date(`${filters.knownAt}T23:59:59.999Z`);
      conditions.push(lte(researchEvidence.createdAt, knownAt));
      conditions.push(sql`COALESCE(${workspaceEvidenceReviews.reviewedAt}, ${researchEvidence.createdAt}) <= ${knownAt}`);
    }
    const rows = await db.select({ evidence: researchEvidence, company: companies, review: workspaceEvidenceReviews })
      .from(researchEvidence)
      .innerJoin(companies, eq(researchEvidence.companyId, companies.id))
      .innerJoin(workspaceEvidenceReviews, eq(workspaceEvidenceReviews.evidenceId, researchEvidence.id))
      .where(and(...conditions))
      .orderBy(desc(researchEvidence.sourceQuality), desc(researchEvidence.documentDate));
    return rows.map((row) => toItem(row));
  });
  if (!result) throw new Error("Postgres is required for comparison memos.");
  return result;
}
