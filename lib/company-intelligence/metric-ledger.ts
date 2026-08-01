import { and, asc, desc, eq } from "drizzle-orm";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";
import { METRIC_DEFINITIONS } from "@/lib/company-intelligence/company-facts";
import { withDatabase } from "@/lib/db/client";
import { canonicalMetrics, companies, companyMetrics, comparisonMemos, metricConflicts, reportingPeriods, workspaceCanonicalMetrics, workspaceMetricReviews } from "@/lib/db/schema";
import { metricCompatibilityKey, metricSourceRank } from "@/lib/company-intelligence/metric-policy";

export type MetricReviewStatus = "proposed" | "accepted" | "rejected";

export type MetricObservation = {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  periodId: string;
  periodLabel: string;
  periodEnd: string;
  metricKey: string;
  label: string;
  category: string;
  normalizedValue: number;
  displayValue: string;
  unit: string;
  context: string;
  confidence: number;
  documentDate: string;
  sourceKind: string;
  sourceLabel: string;
  sourceUrl: string | null;
  taxonomy: string | null;
  concept: string | null;
  valueType: string;
  measurementType: string;
  scopeType: string;
  scopeLabel: string | null;
  periodType: string;
  periodStart: string | null;
  anomalyFlags: string[];
  anomalyScore: number;
  canonicalEligible: boolean;
  isCanonical: boolean;
  reviewStatus: MetricReviewStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  conflictId: string | null;
  conflictStatus: string | null;
};

export type MetricSnapshotItem = Pick<MetricObservation,
  "id" | "companyId" | "companyName" | "ticker" | "periodLabel" | "periodEnd" | "metricKey" | "label" |
  "displayValue" | "normalizedValue" | "unit" | "sourceKind" | "sourceLabel" | "sourceUrl" | "documentDate"
>;

const definitionOrder = new Map(METRIC_DEFINITIONS.map((item, index) => [item.metricKey, index]));

async function ensureWorkspaceMetricDefaults(workspaceId: string) {
  await withDatabase(async (db) => {
    const [metricRows, legacyCanonicalRows, reviewRows, canonicalRows] = await Promise.all([
      db.select().from(companyMetrics),
      db.select().from(canonicalMetrics),
      db.select({ metricId: workspaceMetricReviews.metricId }).from(workspaceMetricReviews).where(eq(workspaceMetricReviews.workspaceId, workspaceId)),
      db.select({ metricId: workspaceCanonicalMetrics.metricId }).from(workspaceCanonicalMetrics).where(eq(workspaceCanonicalMetrics.workspaceId, workspaceId)),
    ]);
    const reviewed = new Set(reviewRows.map((item) => item.metricId));
    for (const item of metricRows) {
      if (reviewed.has(item.id) || (item.reviewStatus === "proposed" && !item.reviewedAt)) continue;
      await db.insert(workspaceMetricReviews).values({
        id: `${workspaceId}:metric-review:${item.id}`,
        workspaceId,
        metricId: item.id,
        reviewStatus: item.reviewStatus,
        reviewNote: item.reviewNote,
        reviewedByUserId: item.reviewedByUserId,
        reviewedAt: item.reviewedAt,
      }).onConflictDoNothing({ target: [workspaceMetricReviews.workspaceId, workspaceMetricReviews.metricId] });
    }
    const selected = new Set(canonicalRows.map((item) => item.metricId));
    for (const item of legacyCanonicalRows) {
      if (selected.has(item.metricId)) continue;
      await db.insert(workspaceCanonicalMetrics).values({
        id: `${workspaceId}:canonical:${item.metricId}`,
        workspaceId,
        companyId: item.companyId,
        periodId: item.periodId,
        metricKey: item.metricKey,
        scopeType: item.scopeType,
        periodType: item.periodType,
        metricId: item.metricId,
        resolutionMethod: "legacy_bootstrap",
        rationale: item.rationale,
        selectedByUserId: item.selectedByUserId,
        selectedAt: item.selectedAt,
      }).onConflictDoNothing({ target: [workspaceCanonicalMetrics.workspaceId, workspaceCanonicalMetrics.periodId, workspaceCanonicalMetrics.metricKey, workspaceCanonicalMetrics.scopeType, workspaceCanonicalMetrics.periodType] });
    }
  });
}

export function hasMetricConflict(values: Array<number | string>, tolerance = 0.02) {
  const numeric = values.map(Number).filter(Number.isFinite);
  if (numeric.length < 2) return false;
  const floor = Math.max(1, Math.min(...numeric.map(Math.abs)));
  return Math.max(...numeric) - Math.min(...numeric) > floor * tolerance;
}

function statusRank(status: MetricReviewStatus) {
  if (status === "accepted") return 2;
  if (status === "proposed") return 1;
  return 0;
}

function periodTypeRank(value?: string) {
  if (value === "quarter") return 4;
  if (value === "annual") return 3;
  if (value === "instant") return 2;
  if (value === "year-to-date") return 1;
  return 0;
}

export function choosePreferredObservation<T extends { reviewStatus: MetricReviewStatus; periodEnd: string; confidence: number; documentDate: string; sourceKind: string; periodType?: string; isCanonical?: boolean; canonicalEligible?: boolean }>(rows: T[]) {
  return [...rows].filter((item) => item.reviewStatus !== "rejected" && (item.isCanonical || item.canonicalEligible !== false)).sort((left, right) =>
    Number(Boolean(right.isCanonical)) - Number(Boolean(left.isCanonical))
    || statusRank(right.reviewStatus) - statusRank(left.reviewStatus)
    || right.periodEnd.localeCompare(left.periodEnd)
    || periodTypeRank(right.periodType) - periodTypeRank(left.periodType)
    || metricSourceRank(right.sourceKind) - metricSourceRank(left.sourceKind)
    || right.confidence - left.confidence
    || right.documentDate.localeCompare(left.documentDate),
  )[0];
}

export async function rebuildMetricConflicts() {
  const result = await withDatabase(async (db) => {
    const rows = await db.select().from(companyMetrics);
    const existing = await db.select().from(metricConflicts);
    const existingByKey = new Map(existing.map((item) => [`${item.periodId}:${item.metricKey}:${item.scopeType}:${item.periodType}:${"reported"}`, item]));
    await db.delete(metricConflicts).where(eq(metricConflicts.status, "open"));
    const standardizedFinancialKeys = new Set(["revenue", "capex", "liquidity", "operating_cash_flow", "debt"]);
    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!standardizedFinancialKeys.has(row.metricKey)) continue;
      const key = `${row.periodId}:${metricCompatibilityKey(row)}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    let open = 0;
    for (const [key, observations] of groups) {
      const distinctSources = new Set(observations.map((item) => item.sourceEvidenceId ?? `${item.sourceKind}:${item.accessionNumber ?? item.id}`));
      if (!observations.some((item) => item.sourceKind === "xbrl") || distinctSources.size < 2 || !hasMetricConflict(observations.map((item) => item.normalizedValue))) continue;
      const previous = existingByKey.get(key);
      const row = {
        id: previous?.id ?? `metric-conflict:${observations[0].periodId}:${observations[0].metricKey}:${observations[0].scopeType}:${observations[0].periodType}`,
        companyId: observations[0].companyId,
        periodId: observations[0].periodId,
        metricKey: observations[0].metricKey,
        scopeType: observations[0].scopeType,
        periodType: observations[0].periodType,
        metricIds: observations.map((item) => item.id),
        status: previous?.status === "resolved" && observations.some((item) => item.id === previous.resolvedMetricId) ? "resolved" : "open",
        updatedAt: new Date(),
      };
      await db.insert(metricConflicts).values(row).onConflictDoUpdate({
        target: [metricConflicts.periodId, metricConflicts.metricKey, metricConflicts.scopeType, metricConflicts.periodType],
        set: { metricIds: row.metricIds, status: row.status, updatedAt: row.updatedAt },
      });
      if (row.status === "open") open += 1;
    }
    return { open };
  });
  if (!result) throw new Error("Postgres is required for metric conflict detection.");
  return result;
}

async function loadObservations(workspaceId: string) {
  await ensureWorkspaceMetricDefaults(workspaceId);
  const result = await withDatabase(async (db) => {
    const rows = await db.select({ metric: companyMetrics, company: companies, period: reportingPeriods })
      .from(companyMetrics)
      .innerJoin(companies, eq(companyMetrics.companyId, companies.id))
      .innerJoin(reportingPeriods, eq(companyMetrics.periodId, reportingPeriods.id))
      .orderBy(desc(reportingPeriods.periodEnd), asc(companies.name), asc(companyMetrics.metricKey));
    const conflicts = await db.select().from(metricConflicts);
    const reviewRows = await db.select().from(workspaceMetricReviews).where(eq(workspaceMetricReviews.workspaceId, workspaceId));
    const reviewsByMetricId = new Map(reviewRows.map((item) => [item.metricId, item]));
    const canonicalRows = await db.select().from(workspaceCanonicalMetrics).where(eq(workspaceCanonicalMetrics.workspaceId, workspaceId));
    const canonicalIds = new Set(canonicalRows.map((item) => item.metricId));
    const conflictByKey = new Map(conflicts.map((item) => [`${item.periodId}:${item.metricKey}:${item.scopeType}:${item.periodType}`, item]));
    return rows.map(({ metric, company, period }): MetricObservation => {
      const conflict = conflictByKey.get(`${metric.periodId}:${metric.metricKey}:${metric.scopeType}:${metric.periodType}`);
      const review = reviewsByMetricId.get(metric.id);
      return {
        id: metric.id, companyId: company.id, companyName: company.name, ticker: company.ticker,
        periodId: period.id, periodLabel: period.label, periodEnd: period.periodEnd,
        metricKey: metric.metricKey, label: metric.label, category: metric.category,
        normalizedValue: Number(metric.normalizedValue), displayValue: metric.displayValue, unit: metric.unit,
        context: metric.context, confidence: metric.confidence, documentDate: metric.documentDate,
        sourceKind: metric.sourceKind, sourceLabel: metric.sourceLabel ?? (metric.sourceKind === "xbrl" ? "SEC Company Facts" : "Source passage"),
        sourceUrl: metric.sourceUrl, taxonomy: metric.taxonomy, concept: metric.concept,
        valueType: metric.valueType, measurementType: metric.measurementType, scopeType: metric.scopeType,
        scopeLabel: metric.scopeLabel, periodType: metric.periodType, periodStart: metric.periodStart,
        anomalyFlags: metric.anomalyFlags as string[], anomalyScore: metric.anomalyScore,
        canonicalEligible: metric.canonicalEligible, isCanonical: canonicalIds.has(metric.id),
        reviewStatus: (review?.reviewStatus ?? "proposed") as MetricReviewStatus,
        reviewNote: review?.reviewNote ?? null, reviewedAt: review?.reviewedAt?.toISOString() ?? null,
        conflictId: conflict?.id ?? null, conflictStatus: conflict ? (canonicalIds.has(metric.id) ? "resolved" : "open") : null,
      };
    });
  });
  if (!result) throw new Error("Postgres is required for the metric ledger.");
  return result;
}

export async function getMetricLedger(workspaceId: string) {
  const observations = await loadObservations(workspaceId);
  const companyList = [...new Map(observations.map((item) => [item.companyId, { id: item.companyId, name: item.companyName, ticker: item.ticker }])).values()];
  const keys = [...new Set(observations.map((item) => item.metricKey))].sort((left, right) =>
    (definitionOrder.get(left) ?? 100) - (definitionOrder.get(right) ?? 100) || left.localeCompare(right),
  );
  const definitions = keys.map((metricKey) => {
    const row = observations.find((item) => item.metricKey === metricKey)!;
    return { metricKey, label: row.label, category: row.category, unit: row.unit };
  });
  const latest = definitions.flatMap((definition) => companyList.flatMap((company) => {
    const selected = choosePreferredObservation(observations.filter((item) => item.metricKey === definition.metricKey && item.companyId === company.id));
    return selected ? [selected] : [];
  }));
  return {
    companies: companyList,
    definitions,
    observations,
    latest,
    summary: {
      accepted: observations.filter((item) => item.reviewStatus === "accepted").length,
      proposed: observations.filter((item) => item.reviewStatus === "proposed").length,
      rejected: observations.filter((item) => item.reviewStatus === "rejected").length,
      canonical: observations.filter((item) => item.isCanonical).length,
      anomalies: observations.filter((item) => item.anomalyFlags.length > 0 && item.reviewStatus !== "rejected").length,
      conflicts: new Set(observations.filter((item) => item.conflictStatus === "open").map((item) => item.conflictId)).size,
      coverage: definitions.length * companyList.length === 0 ? 0 : Math.round(latest.length / (definitions.length * companyList.length) * 100),
    },
  };
}

export async function getAcceptedMetricSnapshot(workspaceId: string, companyIds: string[]): Promise<MetricSnapshotItem[]> {
  if (!companyIds.length) return [];
  const observations = (await loadObservations(workspaceId)).filter((item) => companyIds.includes(item.companyId) && item.isCanonical);
  const selected: MetricObservation[] = [];
  for (const companyId of companyIds) {
    for (const metricKey of new Set(observations.filter((item) => item.companyId === companyId).map((item) => item.metricKey))) {
      const observation = choosePreferredObservation(observations.filter((item) => item.companyId === companyId && item.metricKey === metricKey));
      if (observation) selected.push(observation);
    }
  }
  return selected.map(({ id, companyId, companyName, ticker, periodLabel, periodEnd, metricKey, label, displayValue, normalizedValue, unit, sourceKind, sourceLabel, sourceUrl, documentDate }) => ({
    id, companyId, companyName, ticker, periodLabel, periodEnd, metricKey, label, displayValue, normalizedValue, unit, sourceKind, sourceLabel, sourceUrl, documentDate,
  }));
}

export async function reviewMetricObservation(id: string, status: MetricReviewStatus, note: string | undefined, auth: AuthContext) {
  const result = await withDatabase(async (db) => {
    const metric = (await db.select().from(companyMetrics).where(eq(companyMetrics.id, id)).limit(1))[0];
    if (!metric) throw new Error("Metric observation not found.");
    if (status === "accepted" && !metric.canonicalEligible && !note?.trim()) throw new Error("Flagged observations require an analyst rationale before they can become canonical.");
    const previousCanonical = (await db.select().from(workspaceCanonicalMetrics).where(and(
      eq(workspaceCanonicalMetrics.workspaceId, auth.workspace.id),
      eq(workspaceCanonicalMetrics.periodId, metric.periodId), eq(workspaceCanonicalMetrics.metricKey, metric.metricKey),
      eq(workspaceCanonicalMetrics.scopeType, metric.scopeType), eq(workspaceCanonicalMetrics.periodType, metric.periodType),
    )).limit(1))[0];
    const canonicalChanged = status === "accepted" ? previousCanonical?.metricId !== id : previousCanonical?.metricId === id;
    const now = new Date();
    await db.insert(workspaceMetricReviews).values({
      id: `${auth.workspace.id}:metric-review:${id}`,
      workspaceId: auth.workspace.id,
      metricId: id,
      reviewStatus: status,
      reviewNote: note?.trim() || null,
      reviewedByUserId: auth.user.id,
      reviewedAt: now,
    }).onConflictDoUpdate({
      target: [workspaceMetricReviews.workspaceId, workspaceMetricReviews.metricId],
      set: { reviewStatus: status, reviewNote: note?.trim() || null, reviewedByUserId: auth.user.id, reviewedAt: now, updatedAt: now },
    });
    if (status === "accepted") {
      await db.insert(workspaceCanonicalMetrics).values({
        id: `${auth.workspace.id}:canonical:${id}`, workspaceId: auth.workspace.id, companyId: metric.companyId, periodId: metric.periodId, metricKey: metric.metricKey,
        scopeType: metric.scopeType, periodType: metric.periodType, metricId: id, resolutionMethod: "analyst_review",
        rationale: note?.trim() || "Accepted after source review.", selectedByUserId: auth.user.id,
      }).onConflictDoUpdate({
        target: [workspaceCanonicalMetrics.workspaceId, workspaceCanonicalMetrics.periodId, workspaceCanonicalMetrics.metricKey, workspaceCanonicalMetrics.scopeType, workspaceCanonicalMetrics.periodType],
        set: { metricId: id, resolutionMethod: "analyst_review", rationale: note?.trim() || "Accepted after source review.", selectedByUserId: auth.user.id, selectedAt: new Date(), updatedAt: new Date() },
      });
    } else {
      await db.delete(workspaceCanonicalMetrics).where(and(eq(workspaceCanonicalMetrics.workspaceId, auth.workspace.id), eq(workspaceCanonicalMetrics.metricId, id)));
    }
    const conflict = (await db.select().from(metricConflicts).where(and(eq(metricConflicts.periodId, metric.periodId), eq(metricConflicts.metricKey, metric.metricKey), eq(metricConflicts.scopeType, metric.scopeType), eq(metricConflicts.periodType, metric.periodType))).limit(1))[0];
    if (status === "accepted" && conflict) {
      const siblingIds = (conflict.metricIds as string[]).filter((metricId) => metricId !== id);
      for (const siblingId of siblingIds) {
        await db.insert(workspaceMetricReviews).values({
          id: `${auth.workspace.id}:metric-review:${siblingId}`,
          workspaceId: auth.workspace.id,
          metricId: siblingId,
          reviewStatus: "rejected",
          reviewNote: "Superseded by the workspace canonical selection.",
          reviewedByUserId: auth.user.id,
          reviewedAt: now,
        }).onConflictDoUpdate({
          target: [workspaceMetricReviews.workspaceId, workspaceMetricReviews.metricId],
          set: { reviewStatus: "rejected", reviewNote: "Superseded by the workspace canonical selection.", reviewedByUserId: auth.user.id, reviewedAt: now, updatedAt: now },
        });
      }
    }
    if (canonicalChanged) {
      const memos = await db.select().from(comparisonMemos).where(eq(comparisonMemos.workspaceId, auth.workspace.id));
      for (const memo of memos) {
        const snapshot = memo.metricSnapshot as Array<{ companyId?: string; metricKey?: string }>;
        if (!snapshot.some((item) => item.companyId === metric.companyId && item.metricKey === metric.metricKey)) continue;
        await db.update(comparisonMemos).set({ status: "changes_requested", isStale: true, staleReason: "A canonical KPI changed after analyst review. Regenerate to use the current metric packet.", staleAt: new Date(), updatedAt: new Date() }).where(eq(comparisonMemos.id, memo.id));
      }
    }
    return metric;
  });
  if (!result) throw new Error("Postgres is required to review metrics.");
  await recordAuditEvent(auth, {
    action: `metric.${status}`,
    entityType: "company_metric",
    entityId: id,
    summary: `${status === "accepted" ? "Accepted" : status === "rejected" ? "Rejected" : "Reopened"} ${result.label} observation.`,
    metadata: { companyId: result.companyId, periodId: result.periodId, metricKey: result.metricKey },
  });
  return { id, status };
}
