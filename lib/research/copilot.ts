import { asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withDatabase } from "@/lib/db/client";
import { companies, researchCopilotMessages, researchCopilotSessions, researchEvidence } from "@/lib/db/schema";
import { searchAcceptedEvidence } from "@/lib/research/search";
import type { CopilotClaim, CopilotFilters, CopilotMessage, CopilotSession, ResearchEvidenceItem } from "@/lib/research/types";

const copilotOutputSchema = z.object({
  claims: z.array(z.object({
    companyId: z.string(),
    text: z.string(),
    citationIds: z.array(z.string()),
    confidenceScore: z.number().int().min(0).max(100),
  })),
  openQuestions: z.array(z.object({ companyId: z.string(), text: z.string() })),
});

type Verification = { passed: boolean; rejectedClaims: number; checkedClaims: number; allowedCitations: number };
type CopilotOutput = { claims: CopilotClaim[]; openQuestions: Array<{ companyId: string; text: string }> };

export function chunkCopilotMarkdown(value: string, size = 80) {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += size) chunks.push(value.slice(offset, offset + size));
  return chunks;
}

function sentence(item: ResearchEvidenceItem) {
  const value = item.excerpt.split(/(?<=[.!?])\s+/)[0]?.trim() || item.excerpt.trim();
  return value.length > 360 ? `${value.slice(0, 357).trim()}...` : value;
}

export function verifyCopilotOutput(output: CopilotOutput, evidence: ResearchEvidenceItem[], companyIds: string[]) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  let rejectedClaims = 0;
  const claims = output.claims.filter((claim) => {
    const valid = companyIds.includes(claim.companyId)
      && Boolean(claim.text.trim())
      && claim.citationIds.length > 0
      && claim.citationIds.every((id) => evidenceById.get(id)?.companyId === claim.companyId);
    if (!valid) rejectedClaims += 1;
    return valid;
  }).map((claim) => ({ ...claim, citationIds: [...new Set(claim.citationIds)], confidenceScore: Math.max(0, Math.min(100, Math.round(claim.confidenceScore))) }));
  const openQuestions = output.openQuestions.filter((item) => companyIds.includes(item.companyId) && item.text.trim()).slice(0, 6);
  const verification: Verification = { passed: rejectedClaims === 0, rejectedClaims, checkedClaims: claims.length, allowedCitations: evidence.length };
  return { claims, openQuestions, verification };
}

export function scoreCopilotEvidence(items: ResearchEvidenceItem[], companyIds: string[]) {
  if (!items.length) return { confidence: 0, quality: 0, diversity: 0 };
  const quality = Math.round(items.reduce((sum, item) => sum + item.evidenceQualityScore, 0) / items.length);
  const diversity = Math.min(100, new Set(items.map((item) => `${item.sourceKind}:${item.sourceDocumentId}`)).size * 12 + new Set(items.map((item) => item.sourceKind)).size * 16);
  const covered = companyIds.filter((id) => items.some((item) => item.companyId === id)).length / Math.max(1, companyIds.length);
  const recency = items.filter((item) => Date.now() - new Date(`${item.documentDate}T00:00:00Z`).valueOf() <= 365 * 86_400_000).length / items.length;
  return { confidence: Math.round(quality * .45 + diversity * .2 + covered * 20 + recency * 15), quality, diversity };
}

function deterministicOutput(items: ResearchEvidenceItem[], companyIds: string[]): CopilotOutput {
  const claims = companyIds.flatMap((companyId) => items.filter((item) => item.companyId === companyId).slice(0, 3).map((item) => ({
    companyId,
    text: sentence(item),
    citationIds: [item.id],
    confidenceScore: Math.round(item.evidenceQualityScore * .75 + item.relevanceScore * .25),
  })));
  const topicsByCompany = new Map(companyIds.map((id) => [id, new Set(items.filter((item) => item.companyId === id).map((item) => item.topic))]));
  const openQuestions = companyIds.flatMap((companyId) => {
    const topics = topicsByCompany.get(companyId) ?? new Set<string>();
    if (!topics.has("Financing & liquidity")) return [{ companyId, text: "What funding sources and cost of capital support the next phase of capacity expansion?" }];
    if (!topics.has("Customers & demand")) return [{ companyId, text: "How concentrated is contracted demand, and what portion is take-or-pay?" }];
    return [{ companyId, text: "Which disclosed milestones would most clearly confirm or weaken this infrastructure thesis next quarter?" }];
  });
  return { claims, openQuestions };
}

function buildPrompt(question: string, names: Map<string, string>, evidence: ResearchEvidenceItem[]) {
  const packet = evidence.map((item) => `[${item.id}] ${names.get(item.companyId)} | ${item.sourceType} | ${item.documentDate} | ${item.topic}\n${item.excerpt}`).join("\n\n");
  return `Answer this investor research question using only the approved evidence packet: ${question}\n\nReturn concise claims and open questions. Every factual claim must cite exact evidence IDs belonging to the same company. Do not use outside knowledge, prices, forecasts, or unsupported inference. When evidence is insufficient, omit the claim and create an open question instead.\n\nEVIDENCE PACKET\n${packet}`;
}

function answerMarkdown(output: CopilotOutput, evidence: ResearchEvidenceItem[], names: Map<string, string>) {
  if (!output.claims.length) return "## Insufficient evidence\n\nThe accepted evidence packet does not support a factual answer to this question. Broaden the filters or review additional source passages before drawing a conclusion.";
  const ordinal = new Map(evidence.map((item, index) => [item.id, index + 1]));
  const citations = new Map(evidence.map((item) => [item.id, item]));
  const lines = output.claims.map((claim) => {
    const links = claim.citationIds.map((id) => {
      const item = citations.get(id);
      return item ? `[[${ordinal.get(id)}]](${item.sourceUrl})` : "";
    }).filter(Boolean).join(" ");
    return `- **${names.get(claim.companyId) ?? claim.companyId}:** ${claim.text} ${links}`;
  });
  const questions = output.openQuestions.map((item) => `- **${names.get(item.companyId) ?? item.companyId}:** ${item.text}`);
  return [`## Evidence-backed answer`, "", ...lines, "", "## Open questions", "", ...(questions.length ? questions : ["- No additional evidence gaps were identified for this packet."])].join("\n");
}

function normalizeFilters(filters: Partial<CopilotFilters>, availableCompanyIds?: Set<string>): CopilotFilters {
  const companyIds = [...new Set(filters.companyIds ?? [])].filter((id) => !availableCompanyIds || availableCompanyIds.has(id));
  const sourceKinds = [...new Set(filters.sourceKinds ?? [])].filter((kind): kind is "sec" | "ir" => kind === "sec" || kind === "ir");
  return { companyIds, topic: filters.topic?.trim() || "All topics", sourceKinds, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined };
}

export async function getCopilotCatalog() {
  const result = await withDatabase(async (db) => {
    const companyRows = await db.select().from(companies).orderBy(asc(companies.name));
    const topicRows = await db.selectDistinct({ topic: researchEvidence.topic }).from(researchEvidence).orderBy(asc(researchEvidence.topic));
    return { companies: companyRows.map(({ id, name, ticker }) => ({ id, name, ticker })), topics: topicRows.map((item) => item.topic) };
  });
  if (!result) throw new Error("Postgres is required for the research copilot.");
  return result;
}

export async function createCopilotSession(filters: Partial<CopilotFilters> = {}) {
  const catalog = await getCopilotCatalog();
  const normalized = normalizeFilters(filters, new Set(catalog.companies.map((item) => item.id)));
  if (!normalized.companyIds.length) normalized.companyIds = catalog.companies.map((item) => item.id);
  const id = `copilot:${crypto.randomUUID()}`;
  const rows = await withDatabase((db) => db.insert(researchCopilotSessions).values({ id, title: "New research question", companyIds: normalized.companyIds, topic: normalized.topic, sourceKinds: normalized.sourceKinds, dateFrom: normalized.dateFrom, dateTo: normalized.dateTo }).returning());
  if (!rows?.[0]) throw new Error("Unable to create a research session.");
  return id;
}

function messageFromRow(row: typeof researchCopilotMessages.$inferSelect): CopilotMessage {
  return {
    id: row.id, question: row.question, answerMarkdown: row.answerMarkdown,
    claims: row.claims as CopilotClaim[], openQuestions: row.openQuestions as CopilotMessage["openQuestions"],
    confidenceScore: row.confidenceScore, evidenceQualityScore: row.evidenceQualityScore, sourceDiversityScore: row.sourceDiversityScore,
    engine: row.engine, model: row.model, retrievalMode: row.retrievalMode, status: row.status as CopilotMessage["status"],
    filters: row.filters as CopilotFilters, citations: row.evidenceSnapshot as ResearchEvidenceItem[],
    verification: row.verification as CopilotMessage["verification"], error: row.error, createdAt: row.createdAt.toISOString(),
  };
}

export async function listCopilotSessions() {
  const result = await withDatabase(async (db) => {
    const sessions = await db.select().from(researchCopilotSessions).orderBy(desc(researchCopilotSessions.updatedAt)).limit(30);
    const messages = await db.select().from(researchCopilotMessages).orderBy(desc(researchCopilotMessages.createdAt));
    return sessions.map((session) => ({
      id: session.id, title: session.title, updatedAt: session.updatedAt.toISOString(),
      messageCount: messages.filter((item) => item.sessionId === session.id).length,
      lastQuestion: messages.find((item) => item.sessionId === session.id)?.question ?? null,
    }));
  });
  if (!result) throw new Error("Postgres is required for research history.");
  return result;
}

export async function getCopilotSession(id: string): Promise<CopilotSession> {
  const result = await withDatabase(async (db) => {
    const session = (await db.select().from(researchCopilotSessions).where(eq(researchCopilotSessions.id, id)).limit(1))[0];
    if (!session) return null;
    const messages = await db.select().from(researchCopilotMessages).where(eq(researchCopilotMessages.sessionId, id)).orderBy(asc(researchCopilotMessages.createdAt));
    return {
      id: session.id, title: session.title,
      filters: normalizeFilters({ companyIds: session.companyIds as string[], topic: session.topic, sourceKinds: session.sourceKinds as CopilotFilters["sourceKinds"], dateFrom: session.dateFrom ?? undefined, dateTo: session.dateTo ?? undefined }),
      messages: messages.map(messageFromRow), createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString(),
    };
  });
  if (!result) throw new Error("Research session not found.");
  return result;
}

export async function answerCopilotQuestion(sessionId: string, questionValue: string, inputFilters: Partial<CopilotFilters>) {
  const catalog = await getCopilotCatalog();
  const filters = normalizeFilters(inputFilters, new Set(catalog.companies.map((item) => item.id)));
  const question = questionValue.trim();
  if (!question) throw new Error("Enter a research question.");
  if (!filters.companyIds.length) throw new Error("Select at least one company.");
  const model = process.env.AI_COPILOT_MODEL?.trim() || "gpt-5-mini";
  const hasAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const id = `copilot-message:${crypto.randomUUID()}`;
  await withDatabase((db) => db.insert(researchCopilotMessages).values({ id, sessionId, question, engine: hasAi ? "ai" : "deterministic", model: hasAi ? model : "deterministic-v1", filters }));

  try {
    const retrieval = await searchAcceptedEvidence({ ...filters, query: question, limit: 36 });
    const selected = filters.companyIds.flatMap((companyId) => retrieval.items.filter((item) => item.companyId === companyId).slice(0, 6)).slice(0, 24);
    const names = new Map(catalog.companies.map((item) => [item.id, item.name]));
    const prompt = buildPrompt(question, names, selected);
    let raw = deterministicOutput(selected, filters.companyIds);
    let engine = hasAi ? "ai" : "deterministic";
    let error: string | null = null;
    let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
    if (hasAi && selected.length) {
      try {
        const [{ generateText, Output }, { openai }] = await Promise.all([import("ai"), import("@ai-sdk/openai")]);
        const result = await generateText({ model: openai(model), output: Output.object({ schema: copilotOutputSchema }), prompt, maxOutputTokens: 2200 });
        raw = result.output as CopilotOutput;
        usage = result.totalUsage;
      } catch (generationError) {
        engine = "deterministic-fallback";
        error = generationError instanceof Error ? generationError.message : "AI generation failed; deterministic fallback used.";
      }
    }
    const verified = verifyCopilotOutput(raw, selected, filters.companyIds);
    const scores = scoreCopilotEvidence(selected, filters.companyIds);
    const markdown = answerMarkdown(verified, selected, names);
    await withDatabase(async (db) => {
      await db.update(researchCopilotMessages).set({ answerMarkdown: markdown, claims: verified.claims, openQuestions: verified.openQuestions, confidenceScore: Math.max(0, scores.confidence - verified.verification.rejectedClaims * 5), evidenceQualityScore: scores.quality, sourceDiversityScore: scores.diversity, engine, retrievalMode: retrieval.mode, status: "completed", evidenceSnapshot: selected, verification: verified.verification, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, error, completedAt: new Date() }).where(eq(researchCopilotMessages.id, id));
      await db.update(researchCopilotSessions).set({ title: question.slice(0, 90), companyIds: filters.companyIds, topic: filters.topic, sourceKinds: filters.sourceKinds, dateFrom: filters.dateFrom, dateTo: filters.dateTo, updatedAt: new Date() }).where(eq(researchCopilotSessions.id, sessionId));
    });
    return { id, markdown, verification: verified.verification };
  } catch (generationError) {
    const message = generationError instanceof Error ? generationError.message : "Unable to answer this question.";
    await withDatabase((db) => db.update(researchCopilotMessages).set({ status: "error", error: message, completedAt: new Date() }).where(eq(researchCopilotMessages.id, id)));
    throw generationError;
  }
}
