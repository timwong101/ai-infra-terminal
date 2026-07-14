import { asc, desc, eq, inArray } from "drizzle-orm";
import { compareDisclosureTone, compareMetricValues, extractMetricsFromText } from "@/lib/company-intelligence/extract";
import type { CompanyIntelligenceResponse, IntelligenceComparison, IntelligencePeriod } from "@/lib/company-intelligence/types";
import { withDatabase } from "@/lib/db/client";
import {
  companies,
  companyMetrics,
  filingChanges,
  filings,
  periodComparisons,
  reportingPeriods,
  researchClaims,
  researchEvidence,
} from "@/lib/db/schema";
import type { ResearchEvidenceItem } from "@/lib/research/types";

type PeriodShape = {
  id: string; companyId: string; periodKey: string; label: string; calendarYear: number; calendarQuarter: number;
  periodStart: string; periodEnd: string; latestDocumentDate: string; evidenceCount: number;
};

type MetricShape = {
  id: string; companyId: string; periodId: string; sourceEvidenceId: string; metricKey: string; label: string;
  category: string; normalizedValue: string; displayValue: string; unit: string; context: string; confidence: number; documentDate: string;
};

export function periodForDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const startMonth = (quarter - 1) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1));
  const end = new Date(Date.UTC(year, startMonth + 3, 0));
  return {
    periodKey: `${year}-Q${quarter}`,
    label: `Q${quarter} ${year}`,
    calendarYear: year,
    calendarQuarter: quarter,
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  };
}

function bestMetric(metrics: MetricShape[], key: string) {
  return metrics.filter((item) => item.metricKey === key).sort((left, right) =>
    right.documentDate.localeCompare(left.documentDate) || right.confidence - left.confidence,
  )[0];
}

export async function syncCompanyIntelligence() {
  const result = await withDatabase(async (db) => {
    const evidenceRows = await db.select().from(researchEvidence).orderBy(asc(researchEvidence.documentDate));
    const companyRows = await db.select().from(companies);
    await db.delete(reportingPeriods);

    const periodGroups = new Map<string, { companyId: string; dates: string[]; evidenceIds: string[] }>();
    for (const evidence of evidenceRows) {
      const period = periodForDate(evidence.documentDate);
      const key = `${evidence.companyId}:${period.periodKey}`;
      const group = periodGroups.get(key) ?? { companyId: evidence.companyId, dates: [], evidenceIds: [] };
      group.dates.push(evidence.documentDate);
      group.evidenceIds.push(evidence.id);
      periodGroups.set(key, group);
    }

    const periods: PeriodShape[] = [];
    for (const [key, group] of periodGroups) {
      const periodKey = key.slice(group.companyId.length + 1);
      const period = periodForDate(group.dates[0]);
      const row: PeriodShape = {
        id: `period:${group.companyId}:${periodKey}`, companyId: group.companyId, ...period,
        latestDocumentDate: [...group.dates].sort().at(-1)!, evidenceCount: group.evidenceIds.length,
      };
      await db.insert(reportingPeriods).values(row);
      periods.push(row);
    }

    const periodByCompanyKey = new Map(periods.map((period) => [`${period.companyId}:${period.periodKey}`, period]));
    const metrics: MetricShape[] = [];
    for (const evidence of evidenceRows) {
      const period = periodByCompanyKey.get(`${evidence.companyId}:${periodForDate(evidence.documentDate).periodKey}`);
      if (!period) continue;
      for (const extracted of extractMetricsFromText(evidence.excerpt)) {
        const metric: MetricShape = {
          id: `metric:${evidence.id}:${extracted.metricKey}`, companyId: evidence.companyId, periodId: period.id,
          sourceEvidenceId: evidence.id, metricKey: extracted.metricKey, label: extracted.label, category: extracted.category,
          normalizedValue: String(extracted.normalizedValue), displayValue: extracted.displayValue, unit: extracted.unit,
          context: extracted.context, confidence: Math.min(evidence.sourceQuality, extracted.confidence), documentDate: evidence.documentDate,
        };
        await db.insert(companyMetrics).values(metric);
        metrics.push(metric);
      }
    }

    let metricComparisons = 0;
    const orderedByCompany = new Map<string, PeriodShape[]>();
    for (const company of companyRows) orderedByCompany.set(company.id, periods.filter((period) => period.companyId === company.id).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)));
    for (const [companyId, companyPeriods] of orderedByCompany) {
      for (const [index, currentPeriod] of companyPeriods.entries()) {
        const previousPeriod = companyPeriods[index - 1];
        const currentMetrics = metrics.filter((metric) => metric.periodId === currentPeriod.id);
        const previousMetrics = previousPeriod ? metrics.filter((metric) => metric.periodId === previousPeriod.id) : [];
        for (const metricKey of new Set(currentMetrics.map((metric) => metric.metricKey))) {
          const current = bestMetric(currentMetrics, metricKey);
          const previous = bestMetric(previousMetrics, metricKey);
          const change = compareMetricValues(Number(current.normalizedValue), previous ? Number(previous.normalizedValue) : undefined);
          const delta = change.deltaPercent === null ? "" : ` (${change.deltaPercent > 0 ? "+" : ""}${change.deltaPercent}%)`;
          await db.insert(periodComparisons).values({
            id: `comparison:${currentPeriod.id}:metric:${metricKey}`, companyId, currentPeriodId: currentPeriod.id,
            previousPeriodId: previousPeriod?.id ?? null, currentMetricId: current.id, previousMetricId: previous?.id ?? null,
            comparisonKey: `metric:${metricKey}`, comparisonKind: "metric", category: current.category, label: current.label,
            direction: change.direction, significance: change.significance, currentValue: current.displayValue,
            previousValue: previous?.displayValue ?? null, deltaPercent: change.deltaPercent,
            summary: previous
              ? `${current.label} ${change.direction} from ${previous.displayValue} to ${current.displayValue}${delta}.`
              : `${current.label} was newly identified at ${current.displayValue} in ${currentPeriod.label}.`,
            currentText: current.context, previousText: previous?.context ?? null,
            evidenceIds: [current.sourceEvidenceId, ...(previous ? [previous.sourceEvidenceId] : [])],
          });
          metricComparisons += 1;
        }
      }
    }

    const changes = await db.select({ change: filingChanges, filing: filings }).from(filingChanges)
      .innerJoin(filings, eq(filingChanges.currentFilingId, filings.id));
    let disclosureComparisons = 0;
    for (const { change, filing } of changes) {
      if (["not_repeated", "removed"].includes(change.changeType)) continue;
      if (change.significance === "low" && (change.relevanceScore ?? 0) < 55) continue;
      const period = periodByCompanyKey.get(`${filing.companyId}:${periodForDate(filing.filedAt).periodKey}`);
      if (!period) continue;
      const companyPeriods = orderedByCompany.get(filing.companyId) ?? [];
      const periodIndex = companyPeriods.findIndex((item) => item.id === period.id);
      const previousPeriod = periodIndex > 0 ? companyPeriods[periodIndex - 1] : null;
      const linkedEvidence = evidenceRows.filter((item) => item.sourceKind === "sec" && item.sourceDocumentId === filing.id).slice(0, 3).map((item) => item.id);
      const direction = change.changeType === "explicitly_removed" ? "removed" : change.changeType === "modified" ? "changed" : "new";
      await db.insert(periodComparisons).values({
        id: `comparison:${period.id}:disclosure:${change.id}`, companyId: filing.companyId, currentPeriodId: period.id,
        previousPeriodId: previousPeriod?.id ?? null, comparisonKey: `disclosure:${change.id}`, comparisonKind: "disclosure",
        category: change.category, label: change.eventType ?? change.sectionTitle, direction, significance: change.significance,
        summary: change.relevanceReason ?? change.summary, currentText: change.currentText, previousText: change.previousText,
        evidenceIds: linkedEvidence,
      });
      disclosureComparisons += 1;
    }
    return { periods: periods.length, metrics: metrics.length, metricComparisons, disclosureComparisons };
  });
  if (!result) throw new Error("Company intelligence requires a configured database.");
  return result;
}

function toEvidenceItem(evidence: typeof researchEvidence.$inferSelect, company: typeof companies.$inferSelect): ResearchEvidenceItem {
  return {
    id: evidence.id, companyId: company.id, companyName: company.name, ticker: company.ticker,
    sourceKind: evidence.sourceKind as ResearchEvidenceItem["sourceKind"], sourceDocumentId: evidence.sourceDocumentId,
    sourcePassageId: evidence.sourcePassageId, sourceType: evidence.sourceType, documentTitle: evidence.documentTitle,
    documentDate: evidence.documentDate, sectionTitle: evidence.sectionTitle, topic: evidence.topic, excerpt: evidence.excerpt,
    sourceUrl: evidence.sourceUrl, pageNumber: evidence.pageNumber, sourceQuality: evidence.sourceQuality,
    reviewStatus: evidence.reviewStatus as ResearchEvidenceItem["reviewStatus"], reviewNote: evidence.reviewNote,
    reviewedAt: evidence.reviewedAt?.toISOString() ?? null,
  };
}

function toPeriod(row: typeof reportingPeriods.$inferSelect): IntelligencePeriod {
  return { id: row.id, periodKey: row.periodKey, label: row.label, periodStart: row.periodStart, periodEnd: row.periodEnd, latestDocumentDate: row.latestDocumentDate, evidenceCount: row.evidenceCount };
}

export async function getCompanyIntelligence(companyId?: string, currentPeriodId?: string, previousPeriodId?: string): Promise<CompanyIntelligenceResponse> {
  const result = await withDatabase(async (db) => {
    const companyRows = await db.select().from(companies).orderBy(asc(companies.name));
    const allPeriods = await db.select().from(reportingPeriods).orderBy(desc(reportingPeriods.periodEnd));
    const selectedCompany = companyRows.find((company) => company.id === companyId) ?? companyRows.find((company) => allPeriods.some((period) => period.companyId === company.id));
    if (!selectedCompany) throw new Error("No company intelligence is available yet. Run the intelligence sync first.");
    const periods = allPeriods.filter((period) => period.companyId === selectedCompany.id);
    const current = periods.find((period) => period.id === currentPeriodId) ?? periods[0];
    if (!current) throw new Error("This company has no reporting periods yet.");
    const currentIndex = periods.findIndex((period) => period.id === current.id);
    const previous = periods.find((period) => period.id === previousPeriodId) ?? periods[currentIndex + 1] ?? null;
    const comparisons = await db.select().from(periodComparisons).where(eq(periodComparisons.currentPeriodId, current.id)).orderBy(desc(periodComparisons.significance), asc(periodComparisons.category));
    const disclosures = comparisons.filter((item) => item.comparisonKind === "disclosure");
    const currentMetricRows = await db.select().from(companyMetrics).where(eq(companyMetrics.periodId, current.id));
    const previousMetricRows = previous ? await db.select().from(companyMetrics).where(eq(companyMetrics.periodId, previous.id)) : [];
    const dynamicMetrics: IntelligenceComparison[] = [...new Set(currentMetricRows.map((item) => item.metricKey))].map((metricKey) => {
      const currentMetric = bestMetric(currentMetricRows, metricKey);
      const previousMetric = bestMetric(previousMetricRows, metricKey);
      const change = compareMetricValues(Number(currentMetric.normalizedValue), previousMetric ? Number(previousMetric.normalizedValue) : undefined);
      const delta = change.deltaPercent === null ? "" : ` (${change.deltaPercent > 0 ? "+" : ""}${change.deltaPercent}%)`;
      return {
        id: `dynamic:${current.id}:${previous?.id ?? "none"}:${metricKey}`, comparisonKind: "metric", category: currentMetric.category,
        label: currentMetric.label, direction: change.direction, significance: change.significance, currentValue: currentMetric.displayValue,
        previousValue: previousMetric?.displayValue ?? null, deltaPercent: change.deltaPercent,
        summary: previousMetric
          ? `${currentMetric.label} ${change.direction} from ${previousMetric.displayValue} to ${currentMetric.displayValue}${delta}.`
          : `${currentMetric.label} was identified at ${currentMetric.displayValue} in ${current.label}, with no matching metric in ${previous?.label ?? "the prior period"}.`,
        currentText: currentMetric.context, previousText: previousMetric?.context ?? null,
        evidenceIds: [currentMetric.sourceEvidenceId, ...(previousMetric ? [previousMetric.sourceEvidenceId] : [])],
        tone: "neutral",
      };
    });
    const mappedDisclosures: IntelligenceComparison[] = disclosures.map((item) => ({
      id: item.id, comparisonKind: "disclosure", category: item.category, label: item.label,
      direction: item.direction as IntelligenceComparison["direction"], significance: item.significance as IntelligenceComparison["significance"],
      currentValue: item.currentValue, previousValue: item.previousValue, deltaPercent: item.deltaPercent, summary: item.summary,
      currentText: item.currentText, previousText: item.previousText, evidenceIds: item.evidenceIds as string[],
      tone: compareDisclosureTone(item.currentText ?? "", item.previousText ?? ""),
    }));
    const mapped = [...dynamicMetrics, ...mappedDisclosures];
    const evidenceIds = [...new Set(mapped.flatMap((item) => item.evidenceIds))];
    const evidenceRows = evidenceIds.length ? await db.select().from(researchEvidence).where(inArray(researchEvidence.id, evidenceIds)) : [];
    const claims = await db.select().from(researchClaims).where(eq(researchClaims.companyId, selectedCompany.id)).orderBy(desc(researchClaims.supportScore));
    const evidence = evidenceRows.map((item) => toEvidenceItem(item, selectedCompany));
    return {
      companies: companyRows.map((company) => {
        const companyPeriods = allPeriods.filter((period) => period.companyId === company.id);
        return { id: company.id, name: company.name, ticker: company.ticker, periodCount: companyPeriods.length, latestPeriod: companyPeriods[0]?.label ?? null };
      }).filter((company) => company.periodCount > 0),
      company: { id: selectedCompany.id, name: selectedCompany.name, ticker: selectedCompany.ticker }, periods: periods.map(toPeriod),
      currentPeriod: toPeriod(current), previousPeriod: previous ? toPeriod(previous) : null, comparisons: mapped, evidence,
      claims: claims.map((claim) => ({ id: claim.id, title: claim.title, statement: claim.statement, supportScore: claim.supportScore, kind: claim.kind })),
      summary: {
        metrics: mapped.filter((item) => item.comparisonKind === "metric").length,
        disclosures: mapped.filter((item) => item.comparisonKind === "disclosure").length,
        highSignificance: mapped.filter((item) => item.significance === "high").length,
        evidenceSources: new Set(evidence.map((item) => item.sourceDocumentId)).size,
      },
    };
  });
  if (!result) throw new Error("Company intelligence requires a configured database.");
  return result;
}
