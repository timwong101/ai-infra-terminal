import { and, desc, eq, inArray } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import {
  researchAssistantMessages,
  researchAssistantSessions,
  researchQualityCases,
  researchQualityCaseVersions,
  researchQualityFeedback,
  users,
} from "@/lib/db/schema";
import { recordAuditEvent } from "@/lib/auth/session";
import type { AuthContext } from "@/lib/auth/types";
import type {
  ResearchAssistantFilters,
  ResearchAssistantMessage,
  ResearchEvidenceItem,
  ResearchMetricSnapshot,
  ResearchQualityCase,
  ResearchQualityFailureType,
  ResearchQualityFeedback,
  ResearchQualityTrace,
} from "@/lib/research/types";

export const RESEARCH_FAILURE_TYPES: Array<{ value: ResearchQualityFailureType; label: string }> = [
  { value: "wrong-retrieval", label: "Wrong retrieval" },
  { value: "unsupported-claim", label: "Unsupported claim" },
  { value: "citation-mismatch", label: "Citation mismatch" },
  { value: "incorrect-metric", label: "Incorrect number or scope" },
  { value: "stale-source", label: "Stale source" },
  { value: "missing-evidence", label: "Missing evidence" },
  { value: "should-abstain", label: "Should have abstained" },
  { value: "incorrect-answer", label: "Incorrect answer" },
];

const FAILURE_TYPES = new Set(RESEARCH_FAILURE_TYPES.map((item) => item.value));
const SEVERITIES = new Set(["low", "medium", "high", "critical"]);

function traceFromMessage(row: typeof researchAssistantMessages.$inferSelect): ResearchQualityTrace {
  return {
    sourceType: "research-assistant",
    sourceEntityId: row.id,
    question: row.question,
    answerMarkdown: row.answerMarkdown,
    claims: row.claims as ResearchQualityTrace["claims"],
    filters: row.filters as ResearchAssistantFilters,
    engine: row.engine,
    model: row.model,
    prompt: row.prompt,
    promptVersion: row.promptVersion,
    configSnapshot: row.configSnapshot as Record<string, unknown>,
    retrievalMode: row.retrievalMode,
    evidenceSnapshot: row.evidenceSnapshot as ResearchEvidenceItem[],
    metricSnapshot: row.metricSnapshot as ResearchMetricSnapshot[],
    verification: row.verification as ResearchAssistantMessage["verification"],
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    estimatedCostMicros: row.estimatedCostMicros,
    latencyMs: row.latencyMs,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function requireText(value: unknown, label: string, maxLength: number) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new Error(`${label} is required.`);
  return text.slice(0, maxLength);
}

export async function createResearchQualityFeedback(
  auth: AuthContext,
  input: {
    sourceMessageId?: string;
    failureType?: ResearchQualityFailureType;
    severity?: ResearchQualityFeedback["severity"];
    summary?: string;
    expectedBehavior?: string;
  },
) {
  const sourceMessageId = requireText(input.sourceMessageId, "Source message", 180);
  if (!input.failureType || !FAILURE_TYPES.has(input.failureType)) throw new Error("Select a valid failure type.");
  const severity = input.severity && SEVERITIES.has(input.severity) ? input.severity : "medium";
  const summary = requireText(input.summary, "Issue summary", 800);
  const expectedBehavior = input.expectedBehavior?.trim().slice(0, 1200) || null;

  const message = await withDatabase(async (db) => {
    const rows = await db
      .select({ message: researchAssistantMessages })
      .from(researchAssistantMessages)
      .innerJoin(researchAssistantSessions, eq(researchAssistantMessages.sessionId, researchAssistantSessions.id))
      .where(and(eq(researchAssistantMessages.id, sourceMessageId), eq(researchAssistantSessions.workspaceId, auth.workspace.id)))
      .limit(1);
    return rows[0]?.message ?? null;
  });
  if (!message) throw new Error("The source answer was not found in this workspace.");

  const id = `research-quality-feedback:${crypto.randomUUID()}`;
  const trace = traceFromMessage(message);
  const inserted = await withDatabase((db) => db.insert(researchQualityFeedback).values({
    id,
    workspaceId: auth.workspace.id,
    reporterUserId: auth.user.id,
    sourceType: "research-assistant",
    sourceEntityId: message.id,
    sourceMessageId: message.id,
    failureType: input.failureType!,
    severity,
    summary,
    expectedBehavior,
    traceSnapshot: trace,
  }).returning());
  if (!inserted?.[0]) throw new Error("Postgres is required to report a quality issue.");
  await recordAuditEvent(auth, {
    action: "quality_feedback.created",
    entityType: "research_quality_feedback",
    entityId: id,
    summary: `Reported ${input.failureType.replaceAll("-", " ")} in a research answer.`,
    metadata: { sourceMessageId, severity, promptVersion: trace.promptVersion, model: trace.model },
  });
  return id;
}

export async function listResearchQualityFeedback(workspaceId: string): Promise<ResearchQualityFeedback[]> {
  const result = await withDatabase(async (db) => {
    const rows = await db.select().from(researchQualityFeedback)
      .where(eq(researchQualityFeedback.workspaceId, workspaceId))
      .orderBy(desc(researchQualityFeedback.createdAt))
      .limit(100);
    const userIds = [...new Set(rows.flatMap((row) => [row.reporterUserId, row.adjudicatedByUserId].filter((id): id is string => Boolean(id))))];
    const userRows = userIds.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, userIds)) : [];
    const names = new Map(userRows.map((user) => [user.id, user]));
    return rows.map((row): ResearchQualityFeedback => ({
      id: row.id,
      sourceType: row.sourceType as "research-assistant",
      sourceEntityId: row.sourceEntityId,
      failureType: row.failureType as ResearchQualityFailureType,
      severity: row.severity as ResearchQualityFeedback["severity"],
      summary: row.summary,
      expectedBehavior: row.expectedBehavior,
      status: row.status as ResearchQualityFeedback["status"],
      trace: row.traceSnapshot as ResearchQualityTrace,
      adjudication: row.adjudicationSnapshot as ResearchQualityFeedback["adjudication"],
      promotedCaseId: row.promotedCaseId,
      reporter: names.get(row.reporterUserId) ?? { id: row.reporterUserId, name: "Unknown analyst" },
      adjudicator: row.adjudicatedByUserId ? names.get(row.adjudicatedByUserId) ?? { id: row.adjudicatedByUserId, name: "Unknown analyst" } : null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  });
  if (!result) throw new Error("Postgres is required for quality feedback.");
  return result;
}

export function buildProductionRegressionContract(
  failureType: ResearchQualityFailureType,
  trace: ResearchQualityTrace,
  companyIds: string[],
) {
  const allowedCompanyIds = new Set(trace.filters.companyIds);
  const selectedCompanyIds = [...new Set(companyIds)].filter((companyId) => allowedCompanyIds.has(companyId));
  if (!selectedCompanyIds.length) throw new Error("Select at least one expected company for the regression case.");
  const filters = { ...trace.filters, companyIds: selectedCompanyIds };
  const shouldAbstain = failureType === "should-abstain";
  const topics = filters.topic === "All topics" ? [] : [filters.topic];
  const shouldFreezeEvidence = !["wrong-retrieval", "missing-evidence", "stale-source"].includes(failureType);
  const expectations = {
    topics,
    behavior: shouldAbstain ? "insufficient" as const : "answer" as const,
    minimumCitations: shouldAbstain ? 0 : Math.max(1, filters.companyIds.length),
    expectedEvidenceIds: shouldAbstain || !shouldFreezeEvidence
      ? []
      : trace.evidenceSnapshot.filter((item) => filters.companyIds.includes(item.companyId)).map((item) => item.id),
  };
  return { filters, expectations };
}

export async function adjudicateResearchQualityFeedback(
  auth: AuthContext,
  id: string,
  input: { action?: "adjudicate" | "dismiss" | "promote" | "revise"; expectedBehavior?: string; companyIds?: string[] },
) {
  const expectedBehavior = input.expectedBehavior?.trim().slice(0, 1200) || null;
  const action = input.action;
  if (!action || !["adjudicate", "dismiss", "promote", "revise"].includes(action)) throw new Error("Select a valid adjudication action.");
  if (action !== "dismiss" && !expectedBehavior) throw new Error("Expected behavior is required before adjudication.");

  const result = await withDatabase(async (db) => db.transaction(async (tx) => {
    const feedback = (await tx.select().from(researchQualityFeedback)
      .where(and(eq(researchQualityFeedback.id, id), eq(researchQualityFeedback.workspaceId, auth.workspace.id)))
      .limit(1))[0];
    if (!feedback) throw new Error("Quality feedback not found.");
    if (feedback.status === "promoted" && action === "promote") throw new Error("This issue is already a regression case.");

    if (action === "dismiss") {
      await tx.update(researchQualityFeedback).set({
        status: "dismissed",
        expectedBehavior,
        adjudicationSnapshot: { companyIds: input.companyIds ?? [] },
        adjudicatedByUserId: auth.user.id,
        adjudicatedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(researchQualityFeedback.id, id));
      return { caseId: null, status: "dismissed" as const };
    }

    if (action === "adjudicate") {
      await tx.update(researchQualityFeedback).set({
        status: "adjudicated",
        expectedBehavior,
        adjudicationSnapshot: { companyIds: input.companyIds ?? [] },
        adjudicatedByUserId: auth.user.id,
        adjudicatedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(researchQualityFeedback.id, id));
      return { caseId: null, status: "adjudicated" as const };
    }

    const trace = feedback.traceSnapshot as ResearchQualityTrace;
    const { filters, expectations } = buildProductionRegressionContract(
      feedback.failureType as ResearchQualityFailureType,
      trace,
      input.companyIds ?? trace.filters.companyIds,
    );
    const companyIds = filters.companyIds;
    if (action === "revise") {
      if (feedback.status !== "promoted" || !feedback.promotedCaseId) throw new Error("Promote this issue before creating another version.");
      const currentCase = (await tx.select().from(researchQualityCases)
        .where(and(eq(researchQualityCases.id, feedback.promotedCaseId), eq(researchQualityCases.workspaceId, auth.workspace.id)))
        .limit(1))[0];
      if (!currentCase) throw new Error("The promoted regression case was not found.");
      const nextVersion = currentCase.currentVersion + 1;
      await tx.insert(researchQualityCaseVersions).values({
        id: `research-quality-case-version:${crypto.randomUUID()}`,
        caseId: currentCase.id,
        version: nextVersion,
        question: trace.question,
        filters,
        expectations,
        expectedEvidenceIds: expectations.expectedEvidenceIds,
        traceSnapshot: trace,
        changeNote: expectedBehavior,
        createdByUserId: auth.user.id,
      });
      await tx.update(researchQualityCases).set({ currentVersion: nextVersion, updatedAt: new Date() }).where(eq(researchQualityCases.id, currentCase.id));
      await tx.update(researchQualityFeedback).set({
        expectedBehavior,
        adjudicationSnapshot: { companyIds },
        adjudicatedByUserId: auth.user.id,
        adjudicatedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(researchQualityFeedback.id, id));
      return { caseId: currentCase.id, status: "revised" as const, version: nextVersion };
    }

    const caseId = `research-quality-case:${crypto.randomUUID()}`;
    const versionId = `research-quality-case-version:${crypto.randomUUID()}`;
    const stableKey = `production:${feedback.failureType}:${feedback.id.split(":").at(-1)}`;
    await tx.insert(researchQualityCases).values({
      id: caseId,
      workspaceId: auth.workspace.id,
      sourceFeedbackId: feedback.id,
      stableKey,
      title: trace.question.slice(0, 120),
      category: feedback.failureType,
      createdByUserId: auth.user.id,
    });
    await tx.insert(researchQualityCaseVersions).values({
      id: versionId,
      caseId,
      version: 1,
      question: trace.question,
      filters,
      expectations,
      expectedEvidenceIds: expectations.expectedEvidenceIds,
      traceSnapshot: trace,
      changeNote: expectedBehavior,
      createdByUserId: auth.user.id,
    });
    await tx.update(researchQualityFeedback).set({
      status: "promoted",
      expectedBehavior,
      adjudicationSnapshot: { companyIds },
      promotedCaseId: caseId,
      adjudicatedByUserId: auth.user.id,
      adjudicatedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(researchQualityFeedback.id, id));
    return { caseId, status: "promoted" as const, version: 1 };
  }));
  if (!result) throw new Error("Postgres is required to adjudicate quality feedback.");
  await recordAuditEvent(auth, {
    action: `quality_feedback.${result.status}`,
    entityType: "research_quality_feedback",
    entityId: id,
    summary: result.status === "promoted"
      ? "Promoted a production failure to a regression case."
      : result.status === "revised"
        ? `Created regression case version ${result.version}.`
        : `${result.status === "dismissed" ? "Dismissed" : "Adjudicated"} a quality issue.`,
    metadata: { caseId: result.caseId, version: result.version },
  });
  return result;
}

export async function listResearchQualityCases(workspaceId: string): Promise<ResearchQualityCase[]> {
  const result = await withDatabase(async (db) => {
    const cases = await db.select().from(researchQualityCases)
      .where(eq(researchQualityCases.workspaceId, workspaceId))
      .orderBy(desc(researchQualityCases.updatedAt));
    if (!cases.length) return [];
    const versions = await db.select().from(researchQualityCaseVersions)
      .where(inArray(researchQualityCaseVersions.caseId, cases.map((item) => item.id)));
    const byKey = new Map(versions.map((version) => [`${version.caseId}:${version.version}`, version]));
    return cases.flatMap((item): ResearchQualityCase[] => {
      const version = byKey.get(`${item.id}:${item.currentVersion}`);
      if (!version) return [];
      const expectations = version.expectations as ResearchQualityCase["expectations"];
      return [{
        id: item.id,
        stableKey: item.stableKey,
        title: item.title,
        category: item.category,
        status: item.status as ResearchQualityCase["status"],
        currentVersion: item.currentVersion,
        sourceFeedbackId: item.sourceFeedbackId,
        question: version.question,
        filters: version.filters as ResearchAssistantFilters,
        expectations: { ...expectations, expectedEvidenceIds: version.expectedEvidenceIds as string[] },
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }];
    });
  });
  if (!result) throw new Error("Postgres is required for regression cases.");
  return result;
}
