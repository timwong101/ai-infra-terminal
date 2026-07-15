import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import {
  companies,
  evidencePassages,
  filings,
  filingSections,
  irDocuments,
  irDocumentSections,
  irEvidencePassages,
  researchEvidence,
} from "@/lib/db/schema";
import type { EvidenceFilters, EvidenceReviewStatus, ResearchEvidenceItem } from "@/lib/research/types";

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
  documentDate: string;
  reviewStatus: string;
};

export function selectBaselineEvidenceCandidates(items: BaselineEvidenceCandidate[], minimum = BASELINE_ACCEPTED_PER_COMPANY) {
  const accepted = items.filter((item) => item.reviewStatus === "accepted").length;
  const needed = Math.max(0, minimum - accepted);
  if (!needed) return [];
  const candidates = items.filter((item) => item.reviewStatus === "unreviewed" && item.sourceQuality >= 90)
    .sort((left, right) => right.sourceQuality - left.sourceQuality || right.documentDate.localeCompare(left.documentDate));
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
        topic: topicFor(section.category, section.title, passage.text),
        excerpt: passage.text,
        sourceUrl: document.sourceUrl,
        pageNumber: null,
        sourceQuality: qualityScore(document.extractionQuality, "sec"),
        contentHash: hash(passage.text),
      }).onConflictDoUpdate({
        target: [researchEvidence.sourceKind, researchEvidence.sourcePassageId],
        set: {
          documentTitle: document.documentTitle,
          documentDate: document.filedAt,
          sectionTitle: section.title,
          topic: topicFor(section.category, section.title, passage.text),
          excerpt: passage.text,
          sourceUrl: document.sourceUrl,
          sourceQuality: qualityScore(document.extractionQuality, "sec"),
          contentHash: hash(passage.text),
          updatedAt: new Date(),
        },
      });
    }

    for (const { passage, section, document } of researchGradeIrRows) {
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
        topic: topicFor(section.category, section.title, passage.text),
        excerpt: passage.text,
        sourceUrl: document.sourceUrl,
        pageNumber: passage.pageNumber,
        sourceQuality: qualityScore(document.extractionQuality, "ir"),
        contentHash: hash(passage.text),
      }).onConflictDoUpdate({
        target: [researchEvidence.sourceKind, researchEvidence.sourcePassageId],
        set: {
          documentTitle: document.title,
          documentDate: document.publishedAt,
          sectionTitle: section.title,
          topic: topicFor(section.category, section.title, passage.text),
          excerpt: passage.text,
          sourceUrl: document.sourceUrl,
          pageNumber: passage.pageNumber,
          sourceQuality: qualityScore(document.extractionQuality, "ir"),
          contentHash: hash(passage.text),
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
    let baselineAccepted = 0;
    for (const companyId of new Set(evidenceRows.map((item) => item.companyId))) {
      const selected = selectBaselineEvidenceCandidates(evidenceRows.filter((item) => item.companyId === companyId));
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

function toItem(row: { evidence: typeof researchEvidence.$inferSelect; company: typeof companies.$inferSelect }): ResearchEvidenceItem {
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
    reviewStatus: row.evidence.reviewStatus as EvidenceReviewStatus,
    reviewNote: row.evidence.reviewNote,
    reviewedAt: row.evidence.reviewedAt?.toISOString() ?? null,
  };
}

export async function listResearchEvidence(filters: EvidenceFilters = {}) {
  const result = await withDatabase(async (db) => {
    const rows = await db.select({ evidence: researchEvidence, company: companies })
      .from(researchEvidence)
      .innerJoin(companies, eq(researchEvidence.companyId, companies.id))
      .orderBy(desc(researchEvidence.documentDate), desc(researchEvidence.sourceQuality));
    const query = filters.query?.trim().toLowerCase();
    const allItems = rows.map(toItem);
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
    };
  });
  if (!result) throw new Error("Postgres is required for the research evidence workspace.");
  return result;
}

export async function updateEvidenceReview(ids: string[], status: EvidenceReviewStatus, note?: string) {
  if (!ids.length) return 0;
  const result = await withDatabase(async (db) => {
    const rows = await db.update(researchEvidence).set({
      reviewStatus: status,
      reviewNote: note?.trim() || null,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(inArray(researchEvidence.id, ids)).returning({ id: researchEvidence.id });
    return rows.length;
  });
  if (result === null) throw new Error("Postgres is required for evidence review.");
  return result;
}

export async function getAcceptedEvidence(companyIds: string[], topic?: string) {
  const result = await withDatabase(async (db) => {
    const conditions = [eq(researchEvidence.reviewStatus, "accepted"), inArray(researchEvidence.companyId, companyIds)];
    if (topic && topic !== "All topics") conditions.push(eq(researchEvidence.topic, topic));
    const rows = await db.select({ evidence: researchEvidence, company: companies })
      .from(researchEvidence)
      .innerJoin(companies, eq(researchEvidence.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(desc(researchEvidence.sourceQuality), desc(researchEvidence.documentDate));
    return rows.map(toItem);
  });
  if (!result) throw new Error("Postgres is required for comparison memos.");
  return result;
}
