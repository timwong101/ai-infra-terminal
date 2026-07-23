import { asc, desc, eq, inArray } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { companies, researchEvidence, researchReplayRuns } from "@/lib/db/schema";
import { getAcceptedEvidence } from "@/lib/research/evidence";
import type { ResearchEvidenceItem } from "@/lib/research/types";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";
import type { ReplayClaim, ReplayMode, ResearchReplayCatalog, ResearchReplayRun } from "@/lib/replay/types";

function sentence(value: string) {
  const first = value.split(/(?<=[.!?])\s+/)[0]?.trim() || value.trim();
  return first.length > 360 ? `${first.slice(0, 357).trim()}...` : first;
}

export function buildReplayClaims(items: ResearchEvidenceItem[], companyIds: string[]) {
  const claims: ReplayClaim[] = [];
  for (const companyId of companyIds) {
    const seenTopics = new Set<string>();
    for (const item of items.filter((evidence) => evidence.companyId === companyId)) {
      if (seenTopics.has(item.topic)) continue;
      seenTopics.add(item.topic);
      claims.push({
        id: `replay-claim:${item.id}`,
        companyId,
        companyName: item.companyName,
        text: sentence(item.excerpt),
        topic: item.topic,
        citationIds: [item.id],
      });
      if (seenTopics.size >= 3) break;
    }
  }
  return claims;
}

export function replayLeakageViolations(items: Array<{ documentDate: string; reviewedAt?: string | null }>, asOfDate: string, strict = false) {
  const cutoff = new Date(`${asOfDate}T23:59:59.999Z`).valueOf();
  return items.filter((item) =>
    new Date(`${item.documentDate}T23:59:59.999Z`).valueOf() > cutoff
    || (strict && item.reviewedAt && new Date(item.reviewedAt).valueOf() > cutoff)
  ).length;
}

function scoreReplay(items: ResearchEvidenceItem[], companyIds: string[]) {
  if (!items.length) return 0;
  const quality = items.reduce((sum, item) => sum + item.evidenceQualityScore, 0) / items.length;
  const coverage = companyIds.filter((id) => items.some((item) => item.companyId === id)).length / companyIds.length;
  const diversity = Math.min(1, new Set(items.map((item) => `${item.sourceKind}:${item.sourceDocumentId}`)).size / 8);
  return Math.round(quality * .55 + coverage * 30 + diversity * 15);
}

function selectPacket(items: ResearchEvidenceItem[], companyIds: string[]) {
  return companyIds.flatMap((id) => items.filter((item) => item.companyId === id).slice(0, 10));
}

function rowToRun(row: typeof researchReplayRuns.$inferSelect): ResearchReplayRun {
  return {
    id: row.id,
    asOfDate: row.asOfDate,
    mode: row.mode as ReplayMode,
    companyIds: row.companyIds as string[],
    topic: row.topic,
    question: row.question,
    status: row.status as "completed" | "error",
    summary: row.summary,
    historicalClaims: row.historicalClaims as ReplayClaim[],
    currentClaims: row.currentClaims as ReplayClaim[],
    historicalEvidence: row.historicalEvidenceSnapshot as ResearchEvidenceItem[],
    currentEvidence: row.currentEvidenceSnapshot as ResearchEvidenceItem[],
    addedEvidence: row.addedEvidenceSnapshot as ResearchEvidenceItem[],
    metrics: row.metrics as ResearchReplayRun["metrics"],
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createResearchReplay(input: {
  companyIds: string[];
  asOfDate: string;
  mode: ReplayMode;
  topic: string;
  question: string;
}, auth: AuthContext) {
  const companyIds = [...new Set(input.companyIds)].slice(0, 4);
  if (companyIds.length < 1) throw new Error("Select at least one company.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.asOfDate)) throw new Error("Choose a valid as-of date.");
  if (input.asOfDate >= new Date().toISOString().slice(0, 10)) throw new Error("The replay date must be before today.");
  const companyRows = await withDatabase((db) => db.select().from(companies).where(inArray(companies.id, companyIds)));
  if (companyRows?.length !== companyIds.length) throw new Error("One or more selected companies are unavailable.");

  const topic = input.topic || "All topics";
  const mode: ReplayMode = input.mode === "publication-time" ? "publication-time" : "system-known";
  const question = input.question.trim() || "What did the available evidence support at this point in time, and what changed afterward?";
  const [historicalAll, currentAll] = await Promise.all([
    getAcceptedEvidence(companyIds, topic, {
      dateTo: input.asOfDate,
      ...(mode === "system-known" ? { knownAt: input.asOfDate } : {}),
    }),
    getAcceptedEvidence(companyIds, topic),
  ]);
  const historicalEvidence = selectPacket(historicalAll, companyIds);
  const currentEvidence = selectPacket(currentAll, companyIds);
  const historicalIds = new Set(historicalEvidence.map((item) => item.id));
  const addedEvidence = currentEvidence.filter((item) => !historicalIds.has(item.id));
  const historicalClaims = buildReplayClaims(historicalEvidence, companyIds);
  const currentClaims = buildReplayClaims(currentEvidence, companyIds);
  const leakageViolations = replayLeakageViolations(historicalEvidence, input.asOfDate, mode === "system-known");
  if (leakageViolations > 0) throw new Error("Replay integrity check rejected evidence that was unavailable at the selected date.");
  const historicalCompanyCoverage = companyIds.filter((id) => historicalEvidence.some((item) => item.companyId === id)).length;
  const currentCompanyCoverage = companyIds.filter((id) => currentEvidence.some((item) => item.companyId === id)).length;
  const summary = historicalEvidence.length
    ? `${historicalEvidence.length} approved passages were available in the ${mode.replace("-", " ")} packet. ${addedEvidence.length} currently approved passages arrived later or were unavailable then.`
    : mode === "system-known"
      ? "No approved evidence was known to the system by this date. Switch to publication-time reconstruction to inspect historically published material."
      : "No currently approved evidence had been published by this date.";
  const metrics: ResearchReplayRun["metrics"] = {
    historicalEvidence: historicalEvidence.length,
    currentEvidence: currentEvidence.length,
    addedEvidence: addedEvidence.length,
    historicalCompanyCoverage,
    currentCompanyCoverage,
    leakageViolations,
    confidence: scoreReplay(historicalEvidence, companyIds),
  };
  const id = `replay:${crypto.randomUUID()}`;
  const rows = await withDatabase((db) => db.insert(researchReplayRuns).values({
    id,
    workspaceId: auth.workspace.id,
    ownerUserId: auth.user.id,
    asOfDate: input.asOfDate,
    mode,
    companyIds,
    topic,
    question,
    summary,
    historicalClaims,
    currentClaims,
    historicalEvidenceSnapshot: historicalEvidence,
    currentEvidenceSnapshot: currentEvidence,
    addedEvidenceSnapshot: addedEvidence,
    metrics,
  }).returning());
  if (!rows?.[0]) throw new Error("Postgres is required to save research replays.");
  await recordAuditEvent(auth, {
    action: "research_replay.created",
    entityType: "research_replay",
    entityId: id,
    summary: `Replayed ${companyIds.length} compan${companyIds.length === 1 ? "y" : "ies"} as of ${input.asOfDate}.`,
    metadata: { companyIds, asOfDate: input.asOfDate, mode, leakageViolations },
  });
  return rowToRun(rows[0]);
}

export async function getResearchReplayCatalog(workspaceId: string): Promise<ResearchReplayCatalog> {
  const result = await withDatabase(async (db) => {
    const [companyRows, topicRows, runRows] = await Promise.all([
      db.select().from(companies).orderBy(asc(companies.name)),
      db.selectDistinct({ topic: researchEvidence.topic }).from(researchEvidence).orderBy(asc(researchEvidence.topic)),
      db.select().from(researchReplayRuns).where(eq(researchReplayRuns.workspaceId, workspaceId)).orderBy(desc(researchReplayRuns.createdAt)).limit(30),
    ]);
    return {
      companies: companyRows.map(({ id, name, ticker }) => ({ id, name, ticker })),
      topics: topicRows.map((item) => item.topic),
      runs: runRows.map(rowToRun),
    };
  });
  if (!result) throw new Error("Research replay requires Postgres.");
  return result;
}
