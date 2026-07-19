import { and, desc, eq, gte, inArray, lt, lte, notInArray, sql } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import {
  companies,
  comparisonMemos,
  claimEvidence,
  evidencePassages,
  filings,
  filingSections,
  irDocuments,
  irDocumentSections,
  irEvidencePassages,
  researchEvidence,
  researchClaims,
  users,
} from "@/lib/db/schema";
import { assessEvidenceQuality } from "@/lib/research/quality";
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
const BASELINE_ACCEPTED_PER_COMPANY = 3;

type BaselineEvidenceCandidate = {
  id: string;
  sourceDocumentId: string;
  topic: string;
  sourceQuality: number;
  evidenceQualityScore?: number;
  boilerplateRisk?: number;
  documentDate: string;
  reviewStatus: string;
};

export function selectBaselineEvidenceCandidates(items: BaselineEvidenceCandidate[], minimum = BASELINE_ACCEPTED_PER_COMPANY) {
  const accepted = items.filter((item) =>
    item.reviewStatus === "accepted" &&
    (item.evidenceQualityScore ?? item.sourceQuality) >= 45 &&
    (item.boilerplateRisk ?? 0) < 60
  ).length;
  const needed = Math.max(0, minimum - accepted);
  if (!needed) return [];
  const candidates = items.filter((item) => item.reviewStatus === "unreviewed" && (item.evidenceQualityScore ?? item.sourceQuality) >= 65 && (item.boilerplateRisk ?? 0) < 50)
    .sort((left, right) => (right.evidenceQualityScore ?? right.sourceQuality) - (left.evidenceQualityScore ?? left.sourceQuality) || right.documentDate.localeCompare(left.documentDate));
  const selected: BaselineEvidenceCandidate[] = [];
  const documents = new Set<string>();
  const topics = new Set<string>();
  for (const candidate of candidates) {
    if (selected.length >= needed) break;
    if (documents.has(candidate.sourceDocumentId) || topics.has(candidate.topic)) continue;
    selected.push(candidate);
    documents.add(candidate.sourceDocumentId);
    topics.add(candidate.topic);
  }
  for (const candidate of candidates) {
    if (selected.length >= needed) break;
    if (selected.some((item) => item.id === candidate.id)) continue;
    selected.push(candidate);
  }
  return selected;
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
    await db.delete(researchEvidence).where(secPassageIds.length
      ? and(eq(researchEvidence.sourceKind, "sec"), notInArray(researchEvidence.sourcePassageId, secPassageIds))
      : eq(researchEvidence.sourceKind, "sec"));
    await db.delete(researchEvidence).where(irPassageIds.length
      ? and(eq(researchEvidence.sourceKind, "ir"), notInArray(researchEvidence.sourcePassageId, irPassageIds))
      : eq(researchEvidence.sourceKind, "ir"));

    const evidenceRows = await db.select().from(researchEvidence);
    const duplicateCounts = new Map<string, number>();
    for (const item of evidenceRows) if (item.duplicateGroupId) duplicateCounts.set(item.duplicateGroupId, (duplicateCounts.get(item.duplicateGroupId) ?? 0) + 1);
    for (const [groupId, duplicateCount] of duplicateCounts) {
      await db.update(researchEvidence).set({ duplicateCount }).where(eq(researchEvidence.duplicateGroupId, groupId));
    }
    await db.update(researchEvidence).set({ reviewStatus: "unreviewed", reviewNote: null, reviewedByUserId: null, reviewedAt: null, updatedAt: new Date() }).where(and(
      eq(researchEvidence.reviewStatus, "accepted"),
      sql`${researchEvidence.reviewNote} LIKE 'System baseline:%'`,
      sql`(${researchEvidence.evidenceQualityScore} < 65 OR ${researchEvidence.boilerplateRisk} >= 60)`,
    ));
    const reviewRows = await db.select().from(researchEvidence);
    let baselineAccepted = 0;
    for (const companyId of new Set(reviewRows.map((item) => item.companyId))) {
      const selected = selectBaselineEvidenceCandidates(reviewRows.filter((item) => item.companyId === companyId));
      if (!selected.length) continue;
      const now = new Date();
      const updated = await db.update(researchEvidence).set({
        reviewStatus: "accepted",
        reviewNote: "System baseline: high-quality official evidence accepted to enable grounded company comparisons.",
        reviewedAt: now,
        updatedAt: now,
      }).where(inArray(researchEvidence.id, selected.map((item) => item.id))).returning({ id: researchEvidence.id });
      baselineAccepted += updated.length;
    }

    return { sec: researchGradeSecRows.length, ir: researchGradeIrRows.length, baselineAccepted };
  });
  if (!result) throw new Error("Postgres is required for the research evidence workspace.");
  return result;
}

function toItem(row: { evidence: typeof researchEvidence.$inferSelect; company: typeof companies.$inferSelect; reviewer?: typeof users.$inferSelect | null }, claimTitle?: string | null): ResearchEvidenceItem {
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
    suggestedClaimId: row.evidence.suggestedClaimId,
    suggestedClaimTitle: claimTitle ?? null,
    suggestedImpact: row.evidence.suggestedImpact as ResearchEvidenceItem["suggestedImpact"],
    suggestionConfidence: row.evidence.suggestionConfidence,
    suggestionRationale: row.evidence.suggestionRationale,
    suggestionStatus: row.evidence.suggestionStatus as EvidenceSuggestionStatus,
    qualityScoredAt: row.evidence.qualityScoredAt?.toISOString() ?? null,
    reviewStatus: row.evidence.reviewStatus as EvidenceReviewStatus,
    reviewNote: row.evidence.reviewNote,
    reviewedAt: row.evidence.reviewedAt?.toISOString() ?? null,
    reviewedBy: row.reviewer ? { id: row.reviewer.id, name: row.reviewer.name, email: row.reviewer.email } : null,
  };
}

export async function listResearchEvidence(filters: EvidenceFilters = {}) {
  const result = await withDatabase(async (db) => {
    const rows = await db.select({ evidence: researchEvidence, company: companies, reviewer: users })
      .from(researchEvidence)
      .innerJoin(companies, eq(researchEvidence.companyId, companies.id))
      .leftJoin(users, eq(researchEvidence.reviewedByUserId, users.id))
      .orderBy(desc(researchEvidence.documentDate), desc(researchEvidence.sourceQuality));
    const claimRows = await db.select().from(researchClaims);
    const claimsById = new Map(claimRows.map((claim) => [claim.id, claim.title]));
    const query = filters.query?.trim().toLowerCase();
    const allItems = rows.map((row) => toItem(row, row.evidence.suggestedClaimId ? claimsById.get(row.evidence.suggestedClaimId) : null));
    const items = allItems.filter((item) =>
      (!query || [item.companyName, item.ticker, item.documentTitle, item.sectionTitle, item.topic, item.excerpt].join(" ").toLowerCase().includes(query)) &&
      (!filters.companyId || item.companyId === filters.companyId) &&
      (!filters.topic || item.topic === filters.topic) &&
      (!filters.sourceKind || item.sourceKind === filters.sourceKind) &&
      (!filters.reviewStatus || item.reviewStatus === filters.reviewStatus) &&
      (!filters.dateFrom || item.documentDate >= filters.dateFrom)
    );
    const summary = { unreviewed: 0, accepted: 0, rejected: 0 };
    for (const item of allItems) summary[item.reviewStatus] += 1;
    const companyCounts = new Map<string, { id: string; name: string; ticker: string; evidenceCount: number }>();
    const topicCounts = new Map<string, number>();
    for (const item of allItems) {
      const company = companyCounts.get(item.companyId) ?? { id: item.companyId, name: item.companyName, ticker: item.ticker, evidenceCount: 0 };
      company.evidenceCount += 1;
      companyCounts.set(item.companyId, company);
      topicCounts.set(item.topic, (topicCounts.get(item.topic) ?? 0) + 1);
    }
    return {
      items: items.slice(0, 1_000),
      total: items.length,
      summary,
      companies: [...companyCounts.values()].sort((a, b) => b.evidenceCount - a.evidenceCount),
      topics: [...topicCounts].map(([name, evidenceCount]) => ({ name, evidenceCount })).sort((a, b) => b.evidenceCount - a.evidenceCount),
      claims: claimRows.map((claim) => ({ id: claim.id, companyId: claim.companyId, title: claim.title, kind: claim.kind })),
      qualitySummary: {
        highValue: allItems.filter((item) => item.evidenceQualityScore >= 70 && item.boilerplateRisk < 40).length,
        boilerplateRisk: allItems.filter((item) => item.boilerplateRisk >= 60).length,
        pendingSuggestions: allItems.filter((item) => item.suggestedClaimId && item.suggestionStatus === "pending").length,
        duplicatePassages: allItems.filter((item) => item.duplicateCount > 1).length,
      },
    };
  });
  if (!result) throw new Error("Postgres is required for the research evidence workspace.");
  return result;
}

export async function updateEvidenceReview(ids: string[], status: EvidenceReviewStatus, note: string | undefined, suggestion: { status: EvidenceSuggestionStatus; claimId?: string; impact?: ResearchEvidenceItem["suggestedImpact"] } | undefined, auth: AuthContext) {
  if (!ids.length) return 0;
  const result = await withDatabase(async (db) => {
    const existing = await db.select().from(researchEvidence).where(inArray(researchEvidence.id, ids));
    const rows = await db.update(researchEvidence).set({
      reviewStatus: status,
      reviewNote: note?.trim() || null,
      reviewedByUserId: auth.user.id,
      ...(suggestion ? {
        suggestionStatus: suggestion.status,
        ...(suggestion.claimId ? { suggestedClaimId: suggestion.claimId } : {}),
        ...(suggestion.impact ? { suggestedImpact: suggestion.impact } : {}),
      } : status === "rejected" ? { suggestionStatus: "rejected" } : {}),
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(inArray(researchEvidence.id, ids)).returning({ id: researchEvidence.id });
    const affectedClaimIds = new Set(existing.flatMap((item) => item.suggestedClaimId ? [item.suggestedClaimId] : []));
    if (suggestion?.claimId) affectedClaimIds.add(suggestion.claimId);
    const linked = await db.select().from(claimEvidence).where(inArray(claimEvidence.researchEvidenceId, ids));
    for (const item of linked) affectedClaimIds.add(item.claimId);
    if (affectedClaimIds.size) await db.update(researchClaims).set({ isStale: true, staleReason: "Evidence review changed; rerun thesis scoring.", staleAt: new Date() }).where(inArray(researchClaims.id, [...affectedClaimIds]));

    let staleMemos = 0;
    const memos = await db.select().from(comparisonMemos);
    const idSet = new Set(ids);
    for (const memo of memos) {
      const snapshot = memo.evidenceSnapshot as Array<{ id?: string }>;
      if (!snapshot.some((item) => item.id && idSet.has(item.id))) continue;
      await db.update(comparisonMemos).set({ isStale: true, staleReason: "A cited evidence passage was re-reviewed. Regenerate to use the current approved packet.", staleAt: new Date(), updatedAt: new Date() }).where(eq(comparisonMemos.id, memo.id));
      staleMemos += 1;
    }
    return { updated: rows.length, staleMemos, staleClaims: affectedClaimIds.size };
  });
  if (result === null) throw new Error("Postgres is required for evidence review.");
  await recordAuditEvent(auth, { action: "evidence.reviewed", entityType: "research_evidence", entityId: ids[0], summary: `${status === "accepted" ? "Accepted" : status === "rejected" ? "Rejected" : "Reset"} ${result.updated} evidence passage${result.updated === 1 ? "" : "s"}.`, metadata: { evidenceIds: ids, status, suggestionStatus: suggestion?.status ?? null } });
  return result;
}

export async function getAcceptedEvidence(companyIds: string[], topic?: string, filters?: { sourceKinds?: Array<"sec" | "ir">; dateFrom?: string; dateTo?: string }) {
  const result = await withDatabase(async (db) => {
    const conditions = [eq(researchEvidence.reviewStatus, "accepted"), gte(researchEvidence.evidenceQualityScore, 45), lt(researchEvidence.boilerplateRisk, 60), inArray(researchEvidence.companyId, companyIds)];
    if (topic && topic !== "All topics") conditions.push(eq(researchEvidence.topic, topic));
    if (filters?.sourceKinds?.length) conditions.push(inArray(researchEvidence.sourceKind, filters.sourceKinds));
    if (filters?.dateFrom) conditions.push(gte(researchEvidence.documentDate, filters.dateFrom));
    if (filters?.dateTo) conditions.push(lte(researchEvidence.documentDate, filters.dateTo));
    const rows = await db.select({ evidence: researchEvidence, company: companies })
      .from(researchEvidence)
      .innerJoin(companies, eq(researchEvidence.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(desc(researchEvidence.sourceQuality), desc(researchEvidence.documentDate));
    return rows.map((row) => toItem(row));
  });
  if (!result) throw new Error("Postgres is required for comparison memos.");
  return result;
}
