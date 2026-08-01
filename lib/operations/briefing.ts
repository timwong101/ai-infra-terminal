import { desc, eq, gte } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import {
  companies,
  comparisonMemos,
  filings,
  irDocuments,
  irSourceDocuments,
  researchBriefings,
  researchClaims,
  researchEvidence,
  workspaceClaimStates,
  workspaceEvidenceReviews,
  workspaces,
} from "@/lib/db/schema";
import type { ResearchBriefing, ResearchBriefingEvidence, ResearchBriefingSection, ResearchBriefingStats } from "@/lib/operations/types";

type BriefingInput = {
  companies: Array<{ id: string; name: string; ticker: string }>;
  evidence: ResearchBriefingEvidence[];
  stats: Omit<ResearchBriefingStats, "newEvidence" | "highValueEvidence" | "pendingReview" | "proposedThesisImpacts">;
};

export function buildBriefingContent(input: BriefingInput) {
  const sections: ResearchBriefingSection[] = input.companies.map((company) => {
    const evidence = input.evidence.filter((item) => item.companyId === company.id);
    const duplicateGroups = new Set<string>();
    const uniqueEvidence = evidence.filter((item) => {
      const key = item.duplicateGroupId ?? item.id;
      if (duplicateGroups.has(key)) return false;
      duplicateGroups.add(key);
      return true;
    });
    const byQuality = [...uniqueEvidence].sort((left, right) => right.evidenceQualityScore - left.evidenceQualityScore || right.documentDate.localeCompare(left.documentDate));
    const relevantEvidence = uniqueEvidence.filter((item) => item.relevanceScore >= 35)
      .sort((left, right) => right.relevanceScore - left.relevanceScore || right.evidenceQualityScore - left.evidenceQualityScore);
    return {
      companyId: company.id,
      companyName: company.name,
      ticker: company.ticker,
      newEvidence: evidence.length,
      highValueEvidence: evidence.filter((item) => item.evidenceQualityScore >= 70).length,
      pendingReview: evidence.filter((item) => item.suggestionStatus === "pending" && item.suggestedImpact).length,
      topEvidence: (relevantEvidence.length ? relevantEvidence : byQuality).slice(0, 3),
    };
  }).filter((section) => section.newEvidence > 0);
  const stats: ResearchBriefingStats = {
    ...input.stats,
    newEvidence: input.evidence.length,
    highValueEvidence: input.evidence.filter((item) => item.evidenceQualityScore >= 70).length,
    pendingReview: input.evidence.filter((item) => item.reviewStatus === "unreviewed").length,
    proposedThesisImpacts: input.evidence.filter((item) => item.suggestionStatus === "pending" && item.suggestedImpact).length,
  };
  const companyCount = sections.length;
  const summary = stats.newEvidence
    ? `${stats.newEvidence} new evidence passage${stats.newEvidence === 1 ? "" : "s"} across ${companyCount} monitored compan${companyCount === 1 ? "y" : "ies"}. ${stats.highValueEvidence} scored as high value and ${stats.proposedThesisImpacts} require a thesis-impact decision.`
    : "No new evidence passages were added during this window. Existing stale research and ingestion failures remain visible below.";
  return { stats, sections, summary };
}

function rowToBriefing(row: typeof researchBriefings.$inferSelect): ResearchBriefing {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    runId: row.runId,
    title: row.title,
    summary: row.summary,
    status: row.status,
    windowStartedAt: row.windowStartedAt.toISOString(),
    windowEndedAt: row.windowEndedAt.toISOString(),
    stats: row.stats as ResearchBriefingStats,
    sections: row.sections as ResearchBriefingSection[],
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createResearchBriefing(input: { workspaceId: string; runId?: string | null; since: Date; until?: Date }) {
  const until = input.until ?? new Date();
  const result = await withDatabase(async (db) => {
    const [companyRows, evidenceRows, reviewRows, filingRows, irRows, staleMemoRows, staleClaimRows, claimStateRows, failedIrRows] = await Promise.all([
      db.select().from(companies),
      db.select().from(researchEvidence).where(gte(researchEvidence.createdAt, input.since)),
      db.select().from(workspaceEvidenceReviews).where(eq(workspaceEvidenceReviews.workspaceId, input.workspaceId)),
      db.select().from(filings).where(gte(filings.createdAt, input.since)),
      db.select().from(irDocuments).where(gte(irDocuments.createdAt, input.since)),
      db.select().from(comparisonMemos).where(eq(comparisonMemos.workspaceId, input.workspaceId)),
      db.select().from(researchClaims),
      db.select().from(workspaceClaimStates).where(eq(workspaceClaimStates.workspaceId, input.workspaceId)),
      db.select().from(irSourceDocuments),
    ]);
    const companyById = new Map(companyRows.map((company) => [company.id, company]));
    const reviewByEvidenceId = new Map(reviewRows.map((review) => [review.evidenceId, review]));
    const claimStateByClaimId = new Map(claimStateRows.map((state) => [state.claimId, state]));
    const evidence: ResearchBriefingEvidence[] = evidenceRows.filter((item) => item.createdAt <= until).map((item) => {
      const company = companyById.get(item.companyId);
      const review = reviewByEvidenceId.get(item.id);
      return {
        id: item.id,
        companyId: item.companyId,
        companyName: company?.name ?? item.companyId,
        ticker: company?.ticker ?? item.companyId.toUpperCase(),
        documentTitle: item.documentTitle,
        documentDate: item.documentDate,
        sourceType: item.sourceType,
        topic: item.topic,
        excerpt: item.excerpt,
        sourceUrl: item.sourceUrl,
        evidenceQualityScore: item.evidenceQualityScore,
        relevanceScore: item.relevanceScore,
        duplicateGroupId: item.duplicateGroupId,
        reviewStatus: review?.reviewStatus ?? "unreviewed",
        suggestionStatus: review?.suggestionStatus ?? "pending",
        suggestedImpact: review?.suggestedImpact ?? item.suggestedImpact,
      };
    });
    const content = buildBriefingContent({
      companies: companyRows,
      evidence,
      stats: {
        newDocuments: filingRows.filter((item) => item.createdAt <= until).length + irRows.filter((item) => item.createdAt <= until).length,
        staleMemos: staleMemoRows.filter((item) => item.isStale).length,
        staleClaims: staleClaimRows.filter((item) => claimStateByClaimId.get(item.id)?.isStale ?? item.isStale).length,
        ingestionFailures: failedIrRows.filter((item) => item.extractionStatus === "failed").length,
      },
    });
    const titleDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(until);
    const inserted = await db.insert(researchBriefings).values({
      id: `briefing:${crypto.randomUUID()}`,
      workspaceId: input.workspaceId,
      runId: input.runId ?? null,
      title: `Research briefing · ${titleDate}`,
      summary: content.summary,
      windowStartedAt: input.since,
      windowEndedAt: until,
      stats: content.stats,
      sections: content.sections,
    }).returning();
    return rowToBriefing(inserted[0]);
  });
  if (!result) throw new Error("Research briefings require a configured database.");
  return result;
}

export async function listWorkspaceResearchBriefings(workspaceId: string, limit = 12) {
  const result = await withDatabase(async (db) => {
    const rows = await db.select().from(researchBriefings)
      .where(eq(researchBriefings.workspaceId, workspaceId))
      .orderBy(desc(researchBriefings.createdAt)).limit(limit);
    return rows.map(rowToBriefing);
  });
  if (!result) throw new Error("Research briefings require a configured database.");
  return result;
}

export async function createResearchBriefingsForAllWorkspaces(input: { runId?: string | null; since: Date; until?: Date }) {
  const rows = await withDatabase((db) => db.select({ id: workspaces.id }).from(workspaces));
  if (!rows) throw new Error("Research briefings require a configured database.");
  return Promise.all(rows.map((workspace) => createResearchBriefing({ ...input, workspaceId: workspace.id })));
}
