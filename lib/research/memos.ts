import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { withDatabase } from "@/lib/db/client";
import { companies, comparisonMemos, memoGenerations, researchEvidence } from "@/lib/db/schema";
import { searchAcceptedEvidence } from "@/lib/research/search";
import type { ComparisonMemo, ComparisonMemoSection, MemoClaim, ResearchEvidenceItem } from "@/lib/research/types";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";
import { createDeterministicMemoClaim, isMalformedClaimText, synthesizeMemoSections, verifySynthesizedClaim } from "@/lib/research/claim-synthesis";
import { getAcceptedMetricSnapshot } from "@/lib/company-intelligence/metric-ledger";

const RISK_PATTERN = /risk|depend|concentrat|debt|liquidity|cost|competition|delay|uncertain|adverse/i;
const CATALYST_PATTERN = /growth|expand|capacity|contract|demand|launch|deploy|delivery|availability|pipeline/i;
const RISK_DIRECTION_PATTERN = /\b(adverse|borrow|capital intensive|concentrat|constraint|cost|credit facility|debt|delay|depend|financ|loss|risk|uncertain)\b/i;
const CATALYST_DIRECTION_PATTERN = /\b(capacity|contract|demand|deploy|delivery|energiz|expand|growth|increase|launch|pipeline|secured|signed)\b/i;
const NEGATIVE_CATALYST_PATTERN = /\b(constraint|credit facility|debt|delay|loss|mature|reduces?|risk|uncertain)\b/i;
const SECTION_KEYS = ["summary", "exposure", "advantages", "risks", "catalysts", "questions"] as const;

export function memoEvidenceStaleReason(
  snapshot: Array<{ id?: string; contentHash?: string }>,
  currentById: Map<string, { reviewStatus: string; contentHash: string; evidenceQualityScore: number; boilerplateRisk: number }>,
) {
  for (const item of snapshot) {
    if (!item.id) return "A saved citation no longer has a valid evidence identifier.";
    const current = currentById.get(item.id);
    if (!current) return "A saved citation is no longer present in the evidence catalog.";
    if (current.reviewStatus !== "accepted") return "A saved citation is no longer analyst-approved.";
    if (current.evidenceQualityScore < 45 || current.boilerplateRisk >= 60) return "A saved citation no longer meets the evidence-quality policy.";
    if (item.contentHash && item.contentHash !== current.contentHash) return "A saved citation changed after this memo was generated.";
  }
  return null;
}

const memoOutputSchema = z.object({
  sections: z.array(z.object({
    key: z.enum(SECTION_KEYS),
    title: z.string(),
    claims: z.array(z.object({
      companyId: z.string(),
      text: z.string(),
      citationIds: z.array(z.string()),
      representation: z.enum(["quote", "paraphrase"]),
      whyItMatters: z.string(),
    })),
  })),
});

function claims(items: ResearchEvidenceItem[], key: ComparisonMemoSection["key"], pattern?: RegExp, limit = 3): MemoClaim[] {
  const matches = pattern ? items.filter((item) => pattern.test(`${item.topic} ${item.sectionTitle} ${item.excerpt}`)) : items;
  return matches
    .map((item) => createDeterministicMemoClaim(item, key))
    .filter((claim) =>
      !isMalformedClaimText(claim.text)
      && (!pattern || pattern.test(claim.text))
      && (key !== "risks" || RISK_DIRECTION_PATTERN.test(claim.text))
      && (key !== "catalysts" || CATALYST_DIRECTION_PATTERN.test(claim.text) && !NEGATIVE_CATALYST_PATTERN.test(claim.text))
    )
    .sort((left, right) =>
      Number(right.synthesisStatus === "verified") - Number(left.synthesisStatus === "verified")
      || (right.qualityScore ?? 0) - (left.qualityScore ?? 0)
    )
    .slice(0, limit);
}

function scoreMemo(items: ResearchEvidenceItem[], companyIds: string[]) {
  const quality = items.length ? Math.round(items.reduce((sum, item) => sum + (item.evidenceQualityScore || item.sourceQuality), 0) / items.length) : 0;
  const diversity = Math.min(100, new Set(items.map((item) => item.sourceType)).size * 18 + new Set(items.map((item) => item.sourceDocumentId)).size * 7);
  const counts = companyIds.map((id) => items.filter((item) => item.companyId === id).length);
  const balance = Math.min(...counts) / Math.max(1, Math.max(...counts));
  const coverage = Math.min(100, items.length * 8) * balance;
  const recent = items.filter((item) => Date.now() - new Date(`${item.documentDate}T00:00:00Z`).valueOf() <= 365 * 86_400_000).length;
  return { quality, diversity, confidence: Math.round(quality * .4 + diversity * .2 + coverage * .25 + (items.length ? recent / items.length * 100 : 0) * .15) };
}

function deterministicSections(items: ResearchEvidenceItem[], companyIds: string[]): ComparisonMemoSection[] {
  const byCompany = new Map(companyIds.map((id) => [id, items.filter((item) => item.companyId === id)]));
  const paired = (builder: (companyItems: ResearchEvidenceItem[]) => MemoClaim[]) => companyIds.flatMap((id) => builder(byCompany.get(id) ?? []));
  const questions: MemoClaim[] = [];
  for (const companyId of companyIds) {
    const covered = new Set((byCompany.get(companyId) ?? []).map((item) => item.topic));
    const before = questions.length;
    if (!covered.has("Financing & liquidity")) questions.push({ companyId, text: "What funding sources and cost of capital will support the next phase of capacity expansion?", citationIds: [] });
    if (!covered.has("Customers & demand")) questions.push({ companyId, text: "How concentrated is contracted demand, and what portion is take-or-pay?", citationIds: [] });
    if (!covered.has("Power & capacity")) questions.push({ companyId, text: "How much power is energized today versus merely planned or contracted?", citationIds: [] });
    if (questions.length === before) questions.push({ companyId, text: "Which disclosed milestone would most clearly confirm or weaken this infrastructure thesis next quarter?", citationIds: [] });
  }
  return [
    { key: "summary", title: "Evidence-based summary", claims: paired((items) => claims(items, "summary", undefined, 1)) },
    { key: "exposure", title: "AI infrastructure exposure", claims: paired((items) => claims(items, "exposure", /gpu|compute|capacity|data cent|power|network/i, 3)) },
    { key: "advantages", title: "Potential advantages", claims: paired((items) => claims(items, "advantages", CATALYST_PATTERN, 3)) },
    { key: "risks", title: "Risks and constraints", claims: paired((items) => claims(items, "risks", RISK_PATTERN, 3)) },
    { key: "catalysts", title: "Catalysts to monitor", claims: paired((items) => claims(items, "catalysts", CATALYST_PATTERN, 2)) },
    { key: "questions", title: "Open questions", claims: questions.slice(0, 6) },
  ];
}

export function verifyMemoSections(sections: ComparisonMemoSection[], evidence: ResearchEvidenceItem[], companyIds: string[]) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  let rejectedClaims = 0;
  const verified = SECTION_KEYS.map((key) => {
    const generated = sections.find((section) => section.key === key);
    const claims = (generated?.claims ?? []).filter((claim) => {
      if (!companyIds.includes(claim.companyId) || !claim.text.trim()) { rejectedClaims += 1; return false; }
      if (key === "questions") return true;
      const cited = claim.citationIds.map((id) => evidenceById.get(id)).filter((item): item is ResearchEvidenceItem => Boolean(item));
      const grounded = claim.citationIds.length > 0 && cited.length === claim.citationIds.length && cited.every((item) => item.companyId === claim.companyId);
      const synthesized = !claim.representation || verifySynthesizedClaim(claim, cited).passed;
      const valid = grounded && synthesized;
      if (!valid) rejectedClaims += 1;
      return valid;
    }).map((claim) => ({ ...claim, citationIds: [...new Set(claim.citationIds)] }));
    return { key, title: generated?.title || key[0].toUpperCase() + key.slice(1), claims } as ComparisonMemoSection;
  });
  return { sections: verified, verification: { passed: rejectedClaims === 0, rejectedClaims, checkedClaims: verified.reduce((sum, section) => sum + section.claims.length, 0), allowedCitations: evidence.length } };
}

function buildPrompt(question: string, companyNames: Map<string, string>, evidence: ResearchEvidenceItem[]) {
  const packet = evidence.map((item) => `[${item.id}] ${companyNames.get(item.companyId)} | ${item.sourceType} | ${item.documentDate} | ${item.topic}\n${item.excerpt}`).join("\n\n");
  return `Research question: ${question}\n\nWrite a balanced investment-research comparison using only the evidence packet below.

Claim rules:
- Every factual claim must cite one or more exact evidence IDs from the same company.
- Write concise analyst-grade claims, not raw filing tables or copied slide text.
- Preserve every amount, percentage, date, duration, and capacity unit exactly as disclosed.
- Set representation to "quote" only when the claim text is an exact source quotation; otherwise use "paraphrase".
- Add one short whyItMatters sentence that explains the claim's investment relevance without adding new facts.
- Do not repeat substantially similar claims across sections.
- Do not infer current prices, forecasts, causality, or facts absent from the packet.
- Put unresolved gaps in questions.

Return all six section keys: ${SECTION_KEYS.join(", ")}.

EVIDENCE PACKET
${packet}`;
}

export async function generateComparisonMemo(input: { companyAId: string; companyBId: string; topic: string; question: string }, auth: AuthContext) {
  if (input.companyAId === input.companyBId) throw new Error("Choose two different companies.");
  const companyIds = [input.companyAId, input.companyBId];
  const companyRows = await withDatabase((db) => db.select().from(companies));
  const companyA = companyRows?.find((item) => item.id === input.companyAId);
  const companyB = companyRows?.find((item) => item.id === input.companyBId);
  if (!companyA || !companyB) throw new Error("One or both selected companies are unavailable.");
  const question = input.question.trim() || `Compare ${companyA.name} and ${companyB.name} as AI infrastructure exposure.`;
  const retrieval = await searchAcceptedEvidence({ companyIds, topic: input.topic, query: question, limit: 30 });
  const selected = companyIds.flatMap((id) => retrieval.items.filter((item) => item.companyId === id).slice(0, 10));
  if (companyIds.some((id) => !selected.some((item) => item.companyId === id))) throw new Error("Accept at least one matching evidence passage for each company before generating a comparison.");
  const metricSnapshot = await getAcceptedMetricSnapshot(companyIds);

  const model = process.env.AI_MEMO_MODEL?.trim() || "gpt-5-mini";
  const hasAi = Boolean(process.env.OPENAI_API_KEY?.trim());
  const generationId = `generation:${crypto.randomUUID()}`;
  const names = new Map([[companyA.id, companyA.name], [companyB.id, companyB.name]]);
  const prompt = buildPrompt(question, names, selected);
  await withDatabase((db) => db.insert(memoGenerations).values({ id: generationId, workspaceId: auth.workspace.id, ownerUserId: auth.user.id, companyAId: companyA.id, companyBId: companyB.id, topic: input.topic, question, prompt, model: hasAi ? model : "deterministic-v2", engine: hasAi ? "ai" : "deterministic", retrievalMode: retrieval.mode, evidenceSnapshot: selected, metricSnapshot }));

  let rawSections = deterministicSections(selected, companyIds);
  let engine = hasAi ? "ai" : "deterministic";
  let usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number } = {};
  let generationError: string | null = null;
  if (hasAi) {
    try {
      const [{ generateText, Output }, { openai }] = await Promise.all([import("ai"), import("@ai-sdk/openai")]);
      const result = await generateText({ model: openai(model), output: Output.object({ schema: memoOutputSchema }), prompt, maxOutputTokens: 3200 });
      rawSections = result.output.sections as ComparisonMemoSection[];
      usage = result.totalUsage;
    } catch (error) {
      engine = "deterministic-fallback";
      generationError = error instanceof Error ? error.message : "AI generation failed; deterministic fallback used.";
    }
  }
  const synthesized = synthesizeMemoSections(rawSections, selected, companyIds);
  const verified = verifyMemoSections(synthesized.sections, selected, companyIds);
  const rejectedClaims = verified.verification.rejectedClaims + synthesized.rejectedClaims;
  const verification = {
    ...verified.verification,
    ...synthesized.diagnostics,
    rejectedClaims,
    passed: rejectedClaims === 0,
  };
  const sections = verified.sections;
  const scores = scoreMemo(selected, companyIds);
  const id = `memo:${crypto.randomUUID()}`;
  const stored = await withDatabase(async (db) => {
    const rows = await db.insert(comparisonMemos).values({ id, workspaceId: auth.workspace.id, ownerUserId: auth.user.id, title: `${companyA.name} vs. ${companyB.name}`, question, companyAId: companyA.id, companyBId: companyB.id, topic: input.topic, confidenceScore: Math.max(0, scores.confidence - verification.rejectedClaims * 4), evidenceQualityScore: scores.quality, sourceDiversityScore: scores.diversity, sections, evidenceSnapshot: selected, metricSnapshot }).returning();
    await db.update(memoGenerations).set({ memoId: id, engine, status: "completed", output: { sections }, verification, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.totalTokens, error: generationError, completedAt: new Date() }).where(eq(memoGenerations.id, generationId));
    return rows[0];
  });
  if (!stored) throw new Error("Postgres is required to save comparison memos.");
  await recordAuditEvent(auth, { action: "memo.created", entityType: "comparison_memo", entityId: id, summary: `Created ${companyA.name} vs. ${companyB.name} comparison memo.`, metadata: { companyAId: companyA.id, companyBId: companyB.id, topic: input.topic } });
  return rowToMemo(stored, companyA, companyB, { engine, retrievalMode: retrieval.mode, verification });
}

function rowToMemo(row: typeof comparisonMemos.$inferSelect, companyA: typeof companies.$inferSelect, companyB: typeof companies.$inferSelect, metadata?: ComparisonMemo["generation"]) : ComparisonMemo {
  return { id: row.id, title: row.title, question: row.question, companyA: { id: companyA.id, name: companyA.name, ticker: companyA.ticker }, companyB: { id: companyB.id, name: companyB.name, ticker: companyB.ticker }, topic: row.topic, confidenceScore: row.confidenceScore, evidenceQualityScore: row.evidenceQualityScore, sourceDiversityScore: row.sourceDiversityScore, status: row.status as ComparisonMemo["status"], isStale: row.isStale, staleReason: row.staleReason, staleAt: row.staleAt?.toISOString() ?? null, sections: row.sections as ComparisonMemoSection[], citations: row.evidenceSnapshot as ResearchEvidenceItem[], metricSnapshot: row.metricSnapshot as ComparisonMemo["metricSnapshot"], generation: metadata, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function listComparisonMemos(workspaceId: string) {
  const result = await withDatabase(async (db) => {
    const currentEvidence = await db.select({ id: researchEvidence.id, reviewStatus: researchEvidence.reviewStatus, contentHash: researchEvidence.contentHash, evidenceQualityScore: researchEvidence.evidenceQualityScore, boilerplateRisk: researchEvidence.boilerplateRisk }).from(researchEvidence);
    const currentById = new Map(currentEvidence.map((item) => [item.id, item]));
    const memoRows = await db.select().from(comparisonMemos).where(eq(comparisonMemos.workspaceId, workspaceId)).orderBy(desc(comparisonMemos.updatedAt)).limit(20);
    for (const row of memoRows) {
      if (row.isStale) continue;
      const snapshot = row.evidenceSnapshot as Array<{ id?: string; contentHash?: string }>;
      const staleReason = memoEvidenceStaleReason(snapshot, currentById);
      if (staleReason) await db.update(comparisonMemos).set({ status: "changes_requested", isStale: true, staleReason, staleAt: new Date(), updatedAt: new Date() }).where(eq(comparisonMemos.id, row.id));
    }
    const rows = await db.select().from(comparisonMemos).where(eq(comparisonMemos.workspaceId, workspaceId)).orderBy(desc(comparisonMemos.updatedAt)).limit(20);
    const allCompanies = await db.select().from(companies);
    const generations = await db.select().from(memoGenerations).orderBy(desc(memoGenerations.createdAt));
    return rows.flatMap((row) => {
      const companyA = allCompanies.find((item) => item.id === row.companyAId);
      const companyB = allCompanies.find((item) => item.id === row.companyBId);
      const generation = generations.find((item) => item.memoId === row.id);
      return companyA && companyB ? [rowToMemo(row, companyA, companyB, generation ? {
        engine: generation.engine,
        retrievalMode: generation.retrievalMode,
        verification: generation.verification as NonNullable<ComparisonMemo["generation"]>["verification"],
      } : undefined)] : [];
    });
  });
  if (!result) throw new Error("Postgres is required for comparison memos.");
  return result;
}
