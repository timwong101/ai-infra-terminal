import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";
import { METRIC_DEFINITIONS } from "@/lib/company-intelligence/company-facts";
import { withDatabase } from "@/lib/db/client";
import { canonicalMetrics, companies, companyMetrics, comparisonMemos, metricConflicts, reportingPeriods, researchAlerts } from "@/lib/db/schema";
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
    const rows = await db.select().from(companyMetrics).where(ne(companyMetrics.reviewStatus, "rejected"));
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

async function loadObservations() {
  const result = await withDatabase(async (db) => {
    const rows = await db.select({ metric: companyMetrics, company: companies, period: reportingPeriods })
      .from(companyMetrics)
      .innerJoin(companies, eq(companyMetrics.companyId, companies.id))
      .innerJoin(reportingPeriods, eq(companyMetrics.periodId, reportingPeriods.id))
      .orderBy(desc(reportingPeriods.periodEnd), asc(companies.name), asc(companyMetrics.metricKey));
    const conflicts = await db.select().from(metricConflicts);
    const canonicalRows = await db.select().from(canonicalMetrics);
    const canonicalIds = new Set(canonicalRows.map((item) => item.metricId));
    const conflictByKey = new Map(conflicts.map((item) => [`${item.periodId}:${item.metricKey}:${item.scopeType}:${item.periodType}`, item]));
    return rows.map(({ metric, company, period }): MetricObservation => {
      const conflict = conflictByKey.get(`${metric.periodId}:${metric.metricKey}:${metric.scopeType}:${metric.periodType}`);
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
        reviewStatus: metric.reviewStatus as MetricReviewStatus,
        reviewNote: metric.reviewNote, reviewedAt: metric.reviewedAt?.toISOString() ?? null,
        conflictId: conflict?.id ?? null, conflictStatus: conflict?.status ?? null,
      };
    });
  });
  if (!result) throw new Error("Postgres is required for the metric ledger.");
  return result;
}

export async function getMetricLedger() {
  const observations = await loadObservations();
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

export async function getAcceptedMetricSnapshot(companyIds: string[]): Promise<MetricSnapshotItem[]> {
  if (!companyIds.length) return [];
  const observations = (await loadObservations()).filter((item) => companyIds.includes(item.companyId) && item.isCanonical);
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
    const previousCanonical = (await db.select().from(canonicalMetrics).where(and(
      eq(canonicalMetrics.periodId, metric.periodId), eq(canonicalMetrics.metricKey, metric.metricKey),
      eq(canonicalMetrics.scopeType, metric.scopeType), eq(canonicalMetrics.periodType, metric.periodType),
    )).limit(1))[0];
    const canonicalChanged = status === "accepted" ? previousCanonical?.metricId !== id : previousCanonical?.metricId === id;
    await db.update(companyMetrics).set({ reviewStatus: status, reviewNote: note?.trim() || null, reviewedByUserId: auth.user.id, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(companyMetrics.id, id));
    if (status === "accepted") {
      await db.insert(canonicalMetrics).values({
        id: `canonical:${id}`, companyId: metric.companyId, periodId: metric.periodId, metricKey: metric.metricKey,
        scopeType: metric.scopeType, periodType: metric.periodType, metricId: id, resolutionMethod: "analyst_review",
        rationale: note?.trim() || "Accepted after source review.", selectedByUserId: auth.user.id,
      }).onConflictDoUpdate({
        target: [canonicalMetrics.periodId, canonicalMetrics.metricKey, canonicalMetrics.scopeType, canonicalMetrics.periodType],
        set: { metricId: id, resolutionMethod: "analyst_review", rationale: note?.trim() || "Accepted after source review.", selectedByUserId: auth.user.id, selectedAt: new Date(), updatedAt: new Date() },
      });
    } else {
      await db.delete(canonicalMetrics).where(eq(canonicalMetrics.metricId, id));
    }
    const conflict = (await db.select().from(metricConflicts).where(and(eq(metricConflicts.periodId, metric.periodId), eq(metricConflicts.metricKey, metric.metricKey), eq(metricConflicts.scopeType, metric.scopeType), eq(metricConflicts.periodType, metric.periodType))).limit(1))[0];
    if (status === "accepted" && conflict) {
      const siblingIds = (conflict.metricIds as string[]).filter((metricId) => metricId !== id);
      if (siblingIds.length) await db.update(companyMetrics).set({ reviewStatus: "rejected", updatedAt: new Date() }).where(inArray(companyMetrics.id, siblingIds));
      await db.update(metricConflicts).set({ status: "resolved", resolvedMetricId: id, resolutionNote: note?.trim() || "Accepted as the canonical observation.", resolvedByUserId: auth.user.id, resolvedAt: new Date(), updatedAt: new Date() }).where(eq(metricConflicts.id, conflict.id));
    }
    if (status === "accepted") {
      const periodRows = await db.select().from(reportingPeriods).where(eq(reportingPeriods.companyId, metric.companyId));
      const periodById = new Map(periodRows.map((period) => [period.id, period]));
      const currentPeriod = periodById.get(metric.periodId);
      const canonicalRows = await db.select({ metric: companyMetrics }).from(canonicalMetrics).innerJoin(companyMetrics, eq(canonicalMetrics.metricId, companyMetrics.id)).where(and(
        eq(canonicalMetrics.companyId, metric.companyId), eq(canonicalMetrics.metricKey, metric.metricKey),
        eq(canonicalMetrics.scopeType, metric.scopeType), eq(canonicalMetrics.periodType, metric.periodType),
      ));
      const acceptedRows = canonicalRows.map((item) => item.metric);
      const previous = acceptedRows.filter((item) => item.id !== id && currentPeriod && (periodById.get(item.periodId)?.periodEnd ?? "") < currentPeriod.periodEnd)
        .sort((left, right) => (periodById.get(right.periodId)?.periodEnd ?? "").localeCompare(periodById.get(left.periodId)?.periodEnd ?? ""))[0];
      if (previous && currentPeriod) {
        const previousValue = Number(previous.normalizedValue);
        const currentValue = Number(metric.normalizedValue);
        const deltaPercent = previousValue === 0 ? 0 : Math.round((currentValue - previousValue) / Math.abs(previousValue) * 100);
        if (Math.abs(deltaPercent) >= 10) {
          await db.insert(researchAlerts).values({
            id: `metric-alert:${id}`, companyId: metric.companyId, researchEvidenceId: metric.sourceEvidenceId,
            alertType: "metric_change", category: metric.category,
            significance: Math.abs(deltaPercent) >= 20 ? "high" : "medium",
            impact: deltaPercent > 0 ? "strengthens" : "weakens",
            title: `${metric.label} ${deltaPercent > 0 ? "increased" : "decreased"} ${Math.abs(deltaPercent)}%`,
            summary: `${metric.displayValue} in ${currentPeriod.label}, compared with ${previous.displayValue} in ${periodById.get(previous.periodId)?.label ?? "the prior period"}. This alert was created only after analyst acceptance.`,
          }).onConflictDoUpdate({ target: researchAlerts.id, set: { significance: Math.abs(deltaPercent) >= 20 ? "high" : "medium", impact: deltaPercent > 0 ? "strengthens" : "weakens", summary: `${metric.displayValue} in ${currentPeriod.label}, compared with ${previous.displayValue} in ${periodById.get(previous.periodId)?.label ?? "the prior period"}. This alert was created only after analyst acceptance.`, updatedAt: new Date() } });
        }
      }
    }
    if (canonicalChanged) {
      const memos = await db.select().from(comparisonMemos);
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
