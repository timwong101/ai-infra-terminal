import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withDatabase } from "@/lib/db/client";
import { companies, researchAssistantMessages, researchAssistantSessions, researchEvidence } from "@/lib/db/schema";
import { searchAcceptedEvidence } from "@/lib/research/search";
import type { ResearchAssistantClaim, ResearchAssistantFilters, ResearchAssistantMessage, ResearchAssistantSession, ResearchEvidenceItem } from "@/lib/research/types";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";

const researchAssistantOutputSchema = z.object({
  claims: z.array(z.object({
    companyId: z.string(),
    text: z.string(),
    citationIds: z.array(z.string()),
    confidenceScore: z.number().int().min(0).max(100),
  })),
  openQuestions: z.array(z.object({ companyId: z.string(), text: z.string() })),
});

type Verification = { passed: boolean; rejectedClaims: number; checkedClaims: number; allowedCitations: number };
type ResearchAssistantOutput = { claims: ResearchAssistantClaim[]; openQuestions: Array<{ companyId: string; text: string }> };
export type ResearchAssistantEngine = "auto" | "deterministic" | "ai";

export function chunkResearchAssistantMarkdown(value: string, size = 80) {
  const chunks: string[] = [];
  for (let offset = 0; offset < value.length; offset += size) chunks.push(value.slice(offset, offset + size));
  return chunks;
}

function sentence(item: ResearchEvidenceItem) {
  const value = item.excerpt.split(/(?<=[.!?])\s+/)[0]?.trim() || item.excerpt.trim();
  return value.length > 360 ? `${value.slice(0, 357).trim()}...` : value;
}

export function verifyResearchAssistantOutput(output: ResearchAssistantOutput, evidence: ResearchEvidenceItem[], companyIds: string[]) {
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

export function scoreResearchAssistantEvidence(items: ResearchEvidenceItem[], companyIds: string[]) {
  if (!items.length) return { confidence: 0, quality: 0, diversity: 0 };
  const quality = Math.round(items.reduce((sum, item) => sum + item.evidenceQualityScore, 0) / items.length);
  const diversity = Math.min(100, new Set(items.map((item) => `${item.sourceKind}:${item.sourceDocumentId}`)).size * 12 + new Set(items.map((item) => item.sourceKind)).size * 16);
  const covered = companyIds.filter((id) => items.some((item) => item.companyId === id)).length / Math.max(1, companyIds.length);
  const recency = items.filter((item) => Date.now() - new Date(`${item.documentDate}T00:00:00Z`).valueOf() <= 365 * 86_400_000).length / items.length;
  return { confidence: Math.round(quality * .45 + diversity * .2 + covered * 20 + recency * 15), quality, diversity };
}

function deterministicOutput(items: ResearchEvidenceItem[], companyIds: string[]): ResearchAssistantOutput {
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

function answerMarkdown(output: ResearchAssistantOutput, evidence: ResearchEvidenceItem[], names: Map<string, string>) {
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

function normalizeFilters(filters: Partial<ResearchAssistantFilters>, availableCompanyIds?: Set<string>): ResearchAssistantFilters {
  const companyIds = [...new Set(filters.companyIds ?? [])].filter((id) => !availableCompanyIds || availableCompanyIds.has(id));
  const sourceKinds = [...new Set(filters.sourceKinds ?? [])].filter((kind): kind is "sec" | "ir" => kind === "sec" || kind === "ir");
  return { companyIds, topic: filters.topic?.trim() || "All topics", sourceKinds, dateFrom: filters.dateFrom || undefined, dateTo: filters.dateTo || undefined };
}

export async function runResearchAssistantPipeline(
  questionValue: string,
  inputFilters: Partial<ResearchAssistantFilters>,
  requestedEngine: ResearchAssistantEngine = "auto",
) {
  const startedAt = performance.now();
  const catalog = await getResearchAssistantCatalog();
  const filters = normalizeFilters(inputFilters, new Set(catalog.companies.map((item) => item.id)));
  const question = questionValue.trim();
  if (!question) throw new Error("Enter a research question.");
  if (!filters.companyIds.length) throw new Error("Select at least one company.");

  const model = process.env.AI_RESEARCH_ASSISTANT_MODEL?.trim() || "gpt-5-mini";
  const canUseAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  if (requestedEngine === "ai" && !canUseAi) throw new Error("OPENAI_API_KEY is required for an AI quality run.");
  const useAi = requestedEngine === "ai" || (requestedEngine === "auto" && canUseAi);
  const retrieval = await searchAcceptedEvidence({ ...filters, query: question, limit: 36 });
  const selected = filters.companyIds.flatMap((companyId) => retrieval.items.filter((item) => item.companyId === companyId).slice(0, 6)).slice(0, 24);
  const names = new Map(catalog.companies.map((item) => [item.id, item.name]));
  const prompt = buildPrompt(question, names, selected);
  let raw = deterministicOutput(selected, filters.companyIds);
  let engine = useAi ? "ai" : "deterministic";
  let error: string | null = null;
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};

  if (useAi && selected.length) {
    try {
      const [{ generateText, Output }, { openai }] = await Promise.all([import("ai"), import("@ai-sdk/openai")]);
      const result = await generateText({ model: openai(model), output: Output.object({ schema: researchAssistantOutputSchema }), prompt, maxOutputTokens: 2200 });
      raw = result.output as ResearchAssistantOutput;
      usage = result.totalUsage;
    } catch (generationError) {
      engine = "deterministic-fallback";
      error = generationError instanceof Error ? generationError.message : "AI generation failed; deterministic fallback used.";
    }
  }

  const verified = verifyResearchAssistantOutput(raw, selected, filters.companyIds);
  const scores = scoreResearchAssistantEvidence(selected, filters.companyIds);
  return {
    question,
    filters,
    selected,
    claims: verified.claims,
    openQuestions: verified.openQuestions,
    verification: verified.verification,
    rawClaimCount: raw.claims.length,
    scores,
    markdown: answerMarkdown(verified, selected, names),
    engine,
    model: useAi ? model : "deterministic-v1",
    retrievalMode: retrieval.mode,
    usage,
    error,
    latencyMs: Math.max(1, Math.round(performance.now() - startedAt)),
  };
}

export async function getResearchAssistantCatalog() {
  const result = await withDatabase(async (db) => {
    const companyRows = await db.select().from(companies).orderBy(asc(companies.name));
    const topicRows = await db.selectDistinct({ topic: researchEvidence.topic }).from(researchEvidence).orderBy(asc(researchEvidence.topic));
    return { companies: companyRows.map(({ id, name, ticker }) => ({ id, name, ticker })), topics: topicRows.map((item) => item.topic) };
  });
  if (!result) throw new Error("Postgres is required for the research assistant.");
  return result;
}

export async function createResearchAssistantSession(auth: AuthContext, filters: Partial<ResearchAssistantFilters> = {}) {
  const catalog = await getResearchAssistantCatalog();
  const normalized = normalizeFilters(filters, new Set(catalog.companies.map((item) => item.id)));
  if (!normalized.companyIds.length) normalized.companyIds = catalog.companies.map((item) => item.id);
  const id = `research-assistant:${crypto.randomUUID()}`;
  const rows = await withDatabase((db) => db.insert(researchAssistantSessions).values({ id, workspaceId: auth.workspace.id, ownerUserId: auth.user.id, title: "New research question", companyIds: normalized.companyIds, topic: normalized.topic, sourceKinds: normalized.sourceKinds, dateFrom: normalized.dateFrom, dateTo: normalized.dateTo }).returning());
  if (!rows?.[0]) throw new Error("Unable to create a research session.");
  await recordAuditEvent(auth, { action: "research_session.created", entityType: "research_assistant_session", entityId: id, summary: "Started a new Research Assistant session." });
  return id;
}

function messageFromRow(row: typeof researchAssistantMessages.$inferSelect): ResearchAssistantMessage {
  return {
    id: row.id, question: row.question, answerMarkdown: row.answerMarkdown,
    claims: row.claims as ResearchAssistantClaim[], openQuestions: row.openQuestions as ResearchAssistantMessage["openQuestions"],
    confidenceScore: row.confidenceScore, evidenceQualityScore: row.evidenceQualityScore, sourceDiversityScore: row.sourceDiversityScore,
    engine: row.engine, model: row.model, retrievalMode: row.retrievalMode, status: row.status as ResearchAssistantMessage["status"],
    filters: row.filters as ResearchAssistantFilters, citations: row.evidenceSnapshot as ResearchEvidenceItem[],
    verification: row.verification as ResearchAssistantMessage["verification"], error: row.error, createdAt: row.createdAt.toISOString(),
  };
}

export async function listResearchAssistantSessions(workspaceId: string) {
  const result = await withDatabase(async (db) => {
    const sessions = await db.select().from(researchAssistantSessions).where(eq(researchAssistantSessions.workspaceId, workspaceId)).orderBy(desc(researchAssistantSessions.updatedAt)).limit(30);
    const messages = await db.select().from(researchAssistantMessages).orderBy(desc(researchAssistantMessages.createdAt));
    return sessions.map((session) => ({
      id: session.id, title: session.title, updatedAt: session.updatedAt.toISOString(),
      messageCount: messages.filter((item) => item.sessionId === session.id).length,
      lastQuestion: messages.find((item) => item.sessionId === session.id)?.question ?? null,
    }));
  });
  if (!result) throw new Error("Postgres is required for research history.");
  return result;
}

export async function getResearchAssistantSession(id: string, workspaceId: string): Promise<ResearchAssistantSession> {
  const result = await withDatabase(async (db) => {
    const session = (await db.select().from(researchAssistantSessions).where(and(eq(researchAssistantSessions.id, id), eq(researchAssistantSessions.workspaceId, workspaceId))).limit(1))[0];
    if (!session) return null;
    const messages = await db.select().from(researchAssistantMessages).where(eq(researchAssistantMessages.sessionId, id)).orderBy(asc(researchAssistantMessages.createdAt));
    return {
      id: session.id, title: session.title,
      filters: normalizeFilters({ companyIds: session.companyIds as string[], topic: session.topic, sourceKinds: session.sourceKinds as ResearchAssistantFilters["sourceKinds"], dateFrom: session.dateFrom ?? undefined, dateTo: session.dateTo ?? undefined }),
      messages: messages.map(messageFromRow), createdAt: session.createdAt.toISOString(), updatedAt: session.updatedAt.toISOString(),
    };
  });
  if (!result) throw new Error("Research session not found.");
  return result;
}

export async function answerResearchAssistantQuestion(sessionId: string, questionValue: string, inputFilters: Partial<ResearchAssistantFilters>, auth: AuthContext) {
  const question = questionValue.trim();
  if (!question) throw new Error("Enter a research question.");
  const requestedEngine: ResearchAssistantEngine = "auto";
  const hasAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const id = `research-assistant-message:${crypto.randomUUID()}`;
  const ownsSession = await withDatabase(async (db) => Boolean((await db.select({ id: researchAssistantSessions.id }).from(researchAssistantSessions).where(and(eq(researchAssistantSessions.id, sessionId), eq(researchAssistantSessions.workspaceId, auth.workspace.id))).limit(1))[0]));
  if (!ownsSession) throw new Error("Research session not found in this workspace.");
  await withDatabase((db) => db.insert(researchAssistantMessages).values({ id, sessionId, question, engine: hasAi ? "ai" : "deterministic", model: hasAi ? process.env.AI_RESEARCH_ASSISTANT_MODEL?.trim() || "gpt-5-mini" : "deterministic-v1", filters: inputFilters }));

  try {
    const result = await runResearchAssistantPipeline(question, inputFilters, requestedEngine);
    await withDatabase(async (db) => {
      await db.update(researchAssistantMessages).set({ answerMarkdown: result.markdown, claims: result.claims, openQuestions: result.openQuestions, confidenceScore: Math.max(0, result.scores.confidence - result.verification.rejectedClaims * 5), evidenceQualityScore: result.scores.quality, sourceDiversityScore: result.scores.diversity, engine: result.engine, model: result.model, filters: result.filters, retrievalMode: result.retrievalMode, status: "completed", evidenceSnapshot: result.selected, verification: result.verification, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens, error: result.error, completedAt: new Date() }).where(eq(researchAssistantMessages.id, id));
      await db.update(researchAssistantSessions).set({ title: question.slice(0, 90), companyIds: result.filters.companyIds, topic: result.filters.topic, sourceKinds: result.filters.sourceKinds, dateFrom: result.filters.dateFrom, dateTo: result.filters.dateTo, updatedAt: new Date() }).where(eq(researchAssistantSessions.id, sessionId));
    });
    await recordAuditEvent(auth, { action: "research_answer.created", entityType: "research_assistant_message", entityId: id, summary: `Answered: ${question.slice(0, 120)}`, metadata: { sessionId, engine: result.engine, citationCount: result.selected.length } });
    return { id, markdown: result.markdown, verification: result.verification };
  } catch (generationError) {
    const message = generationError instanceof Error ? generationError.message : "Unable to answer this question.";
    await withDatabase((db) => db.update(researchAssistantMessages).set({ status: "error", error: message, completedAt: new Date() }).where(eq(researchAssistantMessages.id, id)));
    throw generationError;
  }
}
