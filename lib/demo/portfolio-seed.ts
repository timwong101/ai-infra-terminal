import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import type { AuthContext } from "@/lib/auth/types";
import { withDatabase } from "@/lib/db/client";
import {
  comparisonMemos,
  memoReviews,
  researchAssistantMessages,
  researchAssistantSessions,
  researchEvidence,
  workspaceEvidenceReviews,
  metricQualityRuns,
  researchQualityRuns,
  researchReplayRuns,
} from "@/lib/db/schema";
import { generateComparisonMemo } from "@/lib/research/memos";
import { decideMemoReview, submitMemoForReview } from "@/lib/reviews/service";
import { answerResearchAssistantQuestion, createResearchAssistantSession } from "@/lib/research/research-assistant";
import { RESEARCH_QUALITY_SUITE_VERSION, runResearchQualitySuite } from "@/lib/research/research-quality";
import { METRIC_QUALITY_SUITE_VERSION, runMetricQualitySuite } from "@/lib/company-intelligence/metric-quality";
import { createResearchReplay } from "@/lib/replay/service";
import { syncCommitmentCandidates } from "@/lib/company-intelligence/commitments/service";

const COMPANY_IDS = ["coreweave", "nebius", "applied-digital", "iren"];
const TOPICS = ["Power & capacity", "Customers & demand", "Financing & liquidity"];
const SOURCE_KINDS = ["sec", "ir"];

export const PORTFOLIO_MEMO_QUESTION =
  "Compare CoreWeave and Nebius as AI infrastructure exposure, focusing on capacity, demand, financing, and execution risk.";
export const PORTFOLIO_ASSISTANT_QUESTION =
  "Compare CoreWeave, Nebius, Applied Digital, and IREN on disclosed capacity, customer demand, financing risk, and execution.";
export const PORTFOLIO_REPLAY_QUESTION =
  "What did the available evidence support about CoreWeave and Nebius by February 1, 2026, and what changed afterward?";

export type PortfolioEvidenceCandidate = {
  id: string;
  companyId: string;
  topic: string;
  sourceKind: string;
  reviewStatus: string;
  evidenceQualityScore: number;
  specificityScore: number;
  documentDate: string;
};

export type PortfolioDemoSeedSummary = {
  acceptedEvidenceCount: number;
  commitmentSync: { created: number; revised: number; scannedEvidence: number };
  removedEmptySessions: number;
  memoId: string;
  assistantSessionId: string;
  qualityRunId: string;
  metricQualityRunId: string;
  replayRunId: string;
};

function coverageCell(row: Pick<PortfolioEvidenceCandidate, "companyId" | "topic" | "sourceKind">) {
  return `${row.companyId}:${row.topic}:${row.sourceKind}`;
}

export function selectPortfolioBaselineEvidence(rows: PortfolioEvidenceCandidate[]) {
  const acceptedCells = new Set(rows.filter((row) => row.reviewStatus === "accepted").map(coverageCell));
  const selectedCells = new Set<string>();
  return [...rows]
    .sort((left, right) =>
      right.evidenceQualityScore - left.evidenceQualityScore
      || right.specificityScore - left.specificityScore
      || right.documentDate.localeCompare(left.documentDate)
    )
    .filter((row) => {
      const cell = coverageCell(row);
      if (row.reviewStatus !== "unreviewed" || acceptedCells.has(cell) || selectedCells.has(cell)) return false;
      selectedCells.add(cell);
      return true;
    })
    .map((row) => row.id);
}

function demoAuth(identity: { userId: string; workspaceId: string }): AuthContext {
  const workspace = { id: identity.workspaceId, name: "Neocloud Research", slug: "neocloud-research", role: "admin" as const };
  return {
    sessionId: "portfolio-demo-seed",
    user: { id: identity.userId, email: "demo@ai-infra.local", name: "Demo Analyst", avatarUrl: null },
    workspace,
    workspaces: [workspace],
  };
}

function demoReviewerAuth(identity: { workspaceId: string }): AuthContext {
  const workspace = { id: identity.workspaceId, name: "Neocloud Research", slug: "neocloud-research", role: "analyst" as const };
  return {
    sessionId: "portfolio-demo-reviewer",
    user: { id: "user:demo-reviewer", email: "reviewer@ai-infra.local", name: "Demo Reviewer", avatarUrl: null },
    workspace,
    workspaces: [workspace],
  };
}

async function ensureEvidenceCoverage(identity: { userId: string; workspaceId: string }) {
  const candidates = await withDatabase((db) => db
    .select({
      id: researchEvidence.id,
      companyId: researchEvidence.companyId,
      topic: researchEvidence.topic,
      sourceKind: researchEvidence.sourceKind,
      reviewStatus: workspaceEvidenceReviews.reviewStatus,
      evidenceQualityScore: researchEvidence.evidenceQualityScore,
      specificityScore: researchEvidence.specificityScore,
      documentDate: researchEvidence.documentDate,
    })
    .from(researchEvidence)
    .leftJoin(workspaceEvidenceReviews, and(
      eq(workspaceEvidenceReviews.evidenceId, researchEvidence.id),
      eq(workspaceEvidenceReviews.workspaceId, identity.workspaceId),
    ))
    .where(and(
      inArray(researchEvidence.companyId, COMPANY_IDS),
      inArray(researchEvidence.topic, TOPICS),
      inArray(researchEvidence.sourceKind, SOURCE_KINDS),
      gte(researchEvidence.evidenceQualityScore, 45),
      lt(researchEvidence.boilerplateRisk, 60),
    )));
  if (!candidates) throw new Error("Postgres is required to prepare the portfolio demo.");

  const ids = selectPortfolioBaselineEvidence(candidates.map((item) => ({ ...item, reviewStatus: item.reviewStatus ?? "unreviewed" })));
  if (!ids.length) return 0;
  const now = new Date();
  await withDatabase(async (db) => {
    for (const id of ids) {
      await db.insert(workspaceEvidenceReviews).values({
        id: `${identity.workspaceId}:evidence-review:${id}`,
        workspaceId: identity.workspaceId,
        evidenceId: id,
        reviewStatus: "accepted",
        reviewNote: "Portfolio demo baseline: real official evidence accepted to establish deterministic grounded coverage.",
        reviewedByUserId: identity.userId,
        reviewedAt: now,
      }).onConflictDoUpdate({
        target: [workspaceEvidenceReviews.workspaceId, workspaceEvidenceReviews.evidenceId],
        set: { reviewStatus: "accepted", reviewNote: "Portfolio demo baseline: real official evidence accepted to establish deterministic grounded coverage.", reviewedByUserId: identity.userId, reviewedAt: now, updatedAt: now },
      });
    }
  });
  return ids.length;
}

async function removeEmptyAssistantSessions(workspaceId: string) {
  const sessions = await withDatabase((db) => db
    .select({ id: researchAssistantSessions.id })
    .from(researchAssistantSessions)
    .where(eq(researchAssistantSessions.workspaceId, workspaceId)));
  if (!sessions?.length) return 0;
  const sessionIds = sessions.map((session) => session.id);
  const messages = await withDatabase((db) => db
    .selectDistinct({ sessionId: researchAssistantMessages.sessionId })
    .from(researchAssistantMessages)
    .where(inArray(researchAssistantMessages.sessionId, sessionIds)));
  const populated = new Set(messages?.map((message) => message.sessionId) ?? []);
  const emptyIds = sessionIds.filter((id) => !populated.has(id));
  if (emptyIds.length) {
    await withDatabase((db) => db.delete(researchAssistantSessions).where(inArray(researchAssistantSessions.id, emptyIds)));
  }
  return emptyIds.length;
}

async function ensureMemo(auth: AuthContext) {
  const existing = await withDatabase(async (db) => (await db
    .select({ id: comparisonMemos.id })
    .from(comparisonMemos)
    .where(and(
      eq(comparisonMemos.workspaceId, auth.workspace.id),
      eq(comparisonMemos.question, PORTFOLIO_MEMO_QUESTION),
      eq(comparisonMemos.isStale, false),
    ))
    .orderBy(desc(comparisonMemos.createdAt))
    .limit(1))[0] ?? null);
  if (existing) return existing.id;
  const memo = await generateComparisonMemo({
    companyAId: "coreweave",
    companyBId: "nebius",
    topic: "All topics",
    question: PORTFOLIO_MEMO_QUESTION,
  }, auth);
  return memo.id;
}

async function ensureMemoApproval(memoId: string, author: AuthContext) {
  const memo = await withDatabase(async (db) => (await db.select().from(comparisonMemos).where(eq(comparisonMemos.id, memoId)).limit(1))[0] ?? null);
  if (!memo || memo.status === "approved" || memo.status === "published") return;
  const reviewer = demoReviewerAuth({ workspaceId: author.workspace.id });
  const existingReview = await withDatabase(async (db) => (await db.select().from(memoReviews).where(and(
    eq(memoReviews.memoId, memoId),
    eq(memoReviews.status, "in_review"),
  )).orderBy(desc(memoReviews.submittedAt)).limit(1))[0] ?? null);
  const reviewId = existingReview?.id ?? (await submitMemoForReview(memoId, reviewer.user.id, "Portfolio demo: independent review of the frozen evidence packet.", author)).id;
  await decideMemoReview(reviewId, "approved", "Evidence packet, claim checks, and source attribution reviewed for the portfolio demo.", reviewer);
}

async function ensureAssistant(auth: AuthContext) {
  const existing = await withDatabase(async (db) => (await db
    .select({ sessionId: researchAssistantMessages.sessionId })
    .from(researchAssistantMessages)
    .innerJoin(researchAssistantSessions, eq(researchAssistantMessages.sessionId, researchAssistantSessions.id))
    .where(and(
      eq(researchAssistantSessions.workspaceId, auth.workspace.id),
      eq(researchAssistantMessages.question, PORTFOLIO_ASSISTANT_QUESTION),
      eq(researchAssistantMessages.status, "completed"),
    ))
    .orderBy(desc(researchAssistantMessages.createdAt))
    .limit(1))[0] ?? null);
  if (existing) return existing.sessionId;

  const filters = { companyIds: COMPANY_IDS, topic: "All topics", sourceKinds: [] };
  const sessionId = await createResearchAssistantSession(auth, filters);
  await answerResearchAssistantQuestion(sessionId, PORTFOLIO_ASSISTANT_QUESTION, filters, auth);
  return sessionId;
}

async function ensureQualityRun(auth: AuthContext) {
  const existing = await withDatabase(async (db) => (await db
    .select({ id: researchQualityRuns.id })
    .from(researchQualityRuns)
    .where(and(
      eq(researchQualityRuns.workspaceId, auth.workspace.id),
      eq(researchQualityRuns.suiteVersion, RESEARCH_QUALITY_SUITE_VERSION),
      eq(researchQualityRuns.engine, "deterministic"),
      eq(researchQualityRuns.status, "completed"),
    ))
    .orderBy(desc(researchQualityRuns.createdAt))
    .limit(1))[0] ?? null);
  if (existing) return existing.id;
  const run = await runResearchQualitySuite("deterministic", auth);
  if (!run) throw new Error("Unable to prepare the portfolio quality benchmark.");
  return run.id;
}

async function ensureMetricQualityRun(auth: AuthContext) {
  const existing = await withDatabase(async (db) => (await db
    .select({ id: metricQualityRuns.id })
    .from(metricQualityRuns)
    .where(and(
      eq(metricQualityRuns.workspaceId, auth.workspace.id),
      eq(metricQualityRuns.suiteVersion, METRIC_QUALITY_SUITE_VERSION),
      eq(metricQualityRuns.status, "completed"),
    ))
    .orderBy(desc(metricQualityRuns.createdAt))
    .limit(1))[0] ?? null);
  if (existing) return existing.id;
  const run = await runMetricQualitySuite(auth);
  if (!run) throw new Error("Unable to prepare the metric quality benchmark.");
  return run.id;
}

async function ensureReplay(auth: AuthContext) {
  const existing = await withDatabase(async (db) => (await db
    .select({ id: researchReplayRuns.id })
    .from(researchReplayRuns)
    .where(and(
      eq(researchReplayRuns.workspaceId, auth.workspace.id),
      eq(researchReplayRuns.question, PORTFOLIO_REPLAY_QUESTION),
      eq(researchReplayRuns.status, "completed"),
    ))
    .orderBy(desc(researchReplayRuns.createdAt))
    .limit(1))[0] ?? null);
  if (existing) return existing.id;
  const replay = await createResearchReplay({
    companyIds: ["coreweave", "nebius"],
    asOfDate: "2026-02-01",
    mode: "publication-time",
    topic: "All topics",
    question: PORTFOLIO_REPLAY_QUESTION,
  }, auth);
  return replay.id;
}

const inFlight = new Map<string, Promise<PortfolioDemoSeedSummary>>();

export async function ensurePortfolioDemoWorkspace(identity: { userId: string; workspaceId: string }) {
  const current = inFlight.get(identity.workspaceId);
  if (current) return current;
  const task = (async () => {
    const auth = demoAuth(identity);
    const acceptedEvidenceCount = await ensureEvidenceCoverage(identity);
    const commitmentSync = await syncCommitmentCandidates(auth);
    const removedEmptySessions = await removeEmptyAssistantSessions(identity.workspaceId);
    const memoId = await ensureMemo(auth);
    await ensureMemoApproval(memoId, auth);
    const assistantSessionId = await ensureAssistant(auth);
    const qualityRunId = await ensureQualityRun(auth);
    const metricQualityRunId = await ensureMetricQualityRun(auth);
    const replayRunId = await ensureReplay(auth);
    return { acceptedEvidenceCount, commitmentSync, removedEmptySessions, memoId, assistantSessionId, qualityRunId, metricQualityRunId, replayRunId };
  })();
  inFlight.set(identity.workspaceId, task);
  try {
    return await task;
  } finally {
    if (inFlight.get(identity.workspaceId) === task) inFlight.delete(identity.workspaceId);
  }
}
