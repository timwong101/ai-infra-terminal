import { desc, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { companies, comparisonMemos } from "@/lib/db/schema";
import { getAcceptedEvidence } from "@/lib/research/evidence";
import type { ComparisonMemo, ComparisonMemoSection, MemoClaim, ResearchEvidenceItem } from "@/lib/research/types";

const RISK_PATTERN = /risk|depend|concentrat|debt|liquidity|cost|competition|delay|uncertain|adverse/i;
const CATALYST_PATTERN = /growth|expand|capacity|contract|demand|launch|deploy|delivery|availability|pipeline/i;

function conciseClaim(item: ResearchEvidenceItem) {
  const sentence = item.excerpt.split(/(?<=[.!?])\s+/)[0]?.trim() || item.excerpt.trim();
  return sentence.length > 320 ? `${sentence.slice(0, 317).trim()}...` : sentence;
}

function claims(items: ResearchEvidenceItem[], pattern?: RegExp, limit = 3): MemoClaim[] {
  const matches = pattern ? items.filter((item) => pattern.test(`${item.topic} ${item.sectionTitle} ${item.excerpt}`)) : items;
  return matches.slice(0, limit).map((item) => ({ companyId: item.companyId, text: conciseClaim(item), citationIds: [item.id] }));
}

function scoreMemo(items: ResearchEvidenceItem[], companyIds: string[]) {
  const quality = items.length ? Math.round(items.reduce((sum, item) => sum + item.sourceQuality, 0) / items.length) : 0;
  const sourceTypes = new Set(items.map((item) => item.sourceType));
  const documents = new Set(items.map((item) => item.sourceDocumentId));
  const diversity = Math.min(100, sourceTypes.size * 18 + documents.size * 7);
  const counts = companyIds.map((id) => items.filter((item) => item.companyId === id).length);
  const balance = Math.min(...counts) / Math.max(1, Math.max(...counts));
  const coverage = Math.min(100, items.length * 8) * balance;
  const recent = items.filter((item) => Date.now() - new Date(`${item.documentDate}T00:00:00Z`).valueOf() <= 365 * 86400000).length;
  const recency = items.length ? recent / items.length * 100 : 0;
  return {
    quality,
    diversity,
    confidence: Math.round(quality * 0.4 + diversity * 0.2 + coverage * 0.25 + recency * 0.15),
  };
}

function buildSections(items: ResearchEvidenceItem[], companyIds: string[]): ComparisonMemoSection[] {
  const byCompany = new Map(companyIds.map((id) => [id, items.filter((item) => item.companyId === id)]));
  const paired = (builder: (companyItems: ResearchEvidenceItem[]) => MemoClaim[]) => companyIds.flatMap((id) => builder(byCompany.get(id) ?? []));
  const coveredTopics = new Set(items.map((item) => item.topic));
  const questions: MemoClaim[] = [];
  for (const companyId of companyIds) {
    if (!coveredTopics.has("Financing & liquidity")) questions.push({ companyId, text: "What funding sources and cost of capital will support the next phase of capacity expansion?", citationIds: [] });
    if (!coveredTopics.has("Customers & demand")) questions.push({ companyId, text: "How concentrated is contracted demand, and what portion is take-or-pay?", citationIds: [] });
    if (!coveredTopics.has("Power & capacity")) questions.push({ companyId, text: "How much power is energized today versus merely planned or contracted?", citationIds: [] });
  }

  return [
    { key: "summary", title: "Evidence-based summary", claims: paired((companyItems) => claims(companyItems, undefined, 1)) },
    { key: "exposure", title: "AI infrastructure exposure", claims: paired((companyItems) => claims(companyItems, /gpu|compute|capacity|data cent|power|network/i, 3)) },
    { key: "advantages", title: "Potential advantages", claims: paired((companyItems) => claims(companyItems, CATALYST_PATTERN, 3)) },
    { key: "risks", title: "Risks and constraints", claims: paired((companyItems) => claims(companyItems, RISK_PATTERN, 3)) },
    { key: "catalysts", title: "Catalysts to monitor", claims: paired((companyItems) => claims(companyItems, CATALYST_PATTERN, 2)) },
    { key: "questions", title: "Open questions", claims: questions.slice(0, 6) },
  ];
}

export async function generateComparisonMemo(input: { companyAId: string; companyBId: string; topic: string; question: string }) {
  if (input.companyAId === input.companyBId) throw new Error("Choose two different companies.");
  const companyIds = [input.companyAId, input.companyBId];
  const evidence = await getAcceptedEvidence(companyIds, input.topic);
  const counts = companyIds.map((id) => evidence.filter((item) => item.companyId === id).length);
  if (counts.some((count) => count === 0)) {
    throw new Error("Accept at least one matching evidence passage for each company before generating a comparison.");
  }
  const selected = companyIds.flatMap((id) => evidence.filter((item) => item.companyId === id).slice(0, 10));
  const scores = scoreMemo(selected, companyIds);
  const companyRows = await withDatabase((db) => db.select().from(companies).where(eq(companies.id, input.companyAId))) ?? [];
  const companyBRows = await withDatabase((db) => db.select().from(companies).where(eq(companies.id, input.companyBId))) ?? [];
  const companyA = companyRows[0];
  const companyB = companyBRows[0];
  if (!companyA || !companyB) throw new Error("One or both selected companies are unavailable.");
  const now = new Date();
  const id = `memo:${now.valueOf()}:${input.companyAId}:${input.companyBId}`;
  const title = `${companyA.name} vs. ${companyB.name}`;
  const sections = buildSections(selected, companyIds);
  const stored = await withDatabase(async (db) => {
    const rows = await db.insert(comparisonMemos).values({
      id,
      title,
      question: input.question.trim() || `Compare ${companyA.name} and ${companyB.name} as AI infrastructure exposure.`,
      companyAId: companyA.id,
      companyBId: companyB.id,
      topic: input.topic,
      confidenceScore: scores.confidence,
      evidenceQualityScore: scores.quality,
      sourceDiversityScore: scores.diversity,
      sections,
      evidenceSnapshot: selected,
    }).returning();
    return rows[0];
  });
  if (!stored) throw new Error("Postgres is required to save comparison memos.");
  return rowToMemo(stored, companyA, companyB);
}

function rowToMemo(row: typeof comparisonMemos.$inferSelect, companyA: typeof companies.$inferSelect, companyB: typeof companies.$inferSelect): ComparisonMemo {
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    companyA: { id: companyA.id, name: companyA.name, ticker: companyA.ticker },
    companyB: { id: companyB.id, name: companyB.name, ticker: companyB.ticker },
    topic: row.topic,
    confidenceScore: row.confidenceScore,
    evidenceQualityScore: row.evidenceQualityScore,
    sourceDiversityScore: row.sourceDiversityScore,
    status: row.status as ComparisonMemo["status"],
    sections: row.sections as ComparisonMemoSection[],
    citations: row.evidenceSnapshot as ResearchEvidenceItem[],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listComparisonMemos() {
  const result = await withDatabase(async (db) => {
    const rows = await db.select().from(comparisonMemos).orderBy(desc(comparisonMemos.updatedAt)).limit(20);
    const output: ComparisonMemo[] = [];
    for (const row of rows) {
      const companyA = (await db.select().from(companies).where(eq(companies.id, row.companyAId)).limit(1))[0];
      const companyB = (await db.select().from(companies).where(eq(companies.id, row.companyBId)).limit(1))[0];
      if (companyA && companyB) output.push(rowToMemo(row, companyA, companyB));
    }
    return output;
  });
  if (!result) throw new Error("Postgres is required for comparison memos.");
  return result;
}
