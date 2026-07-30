import { createHash } from "node:crypto";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { buildEarningsChangeBrief } from "@/lib/company-intelligence/brief-builder";
import type { BriefComparisonInput } from "@/lib/company-intelligence/brief-builder";
import { compareDisclosureTone, compareMetricValues, extractMetricsFromText } from "@/lib/company-intelligence/extract";
import { fetchCompanyFacts } from "@/lib/company-intelligence/company-facts";
import { rebuildMetricConflicts } from "@/lib/company-intelligence/metric-ledger";
import { analyzeMetricObservation } from "@/lib/company-intelligence/metric-policy";
import { calendarPeriodForDate, resolveDocumentPeriods } from "@/lib/company-intelligence/period-resolver";
import type { CompanyIntelligenceResponse, EarningsChangeBrief, IntelligenceComparison, IntelligencePeriod } from "@/lib/company-intelligence/types";
import { withDatabase } from "@/lib/db/client";
import {
  companies,
  canonicalMetrics,
  companyMetrics,
  earningsChangeBriefClaims,
  earningsChangeBriefs,
  earningsChangeBriefVersions,
  earningsPackageDocuments,
  earningsPackages,
  filingChanges,
  filings,
  irDocuments,
  irSourceDocuments,
  periodComparisons,
  reportingPeriods,
  researchClaims,
  researchEvidence,
} from "@/lib/db/schema";
import type { ResearchEvidenceItem } from "@/lib/research/types";
import { validateSecUserAgent } from "@/lib/sec/client";

type PeriodShape = {
  id: string; companyId: string; periodKey: string; label: string; calendarYear: number; calendarQuarter: number;
  periodKind: string; periodBasis: string; fiscalYear: number | null; fiscalQuarter: number | null;
  resolutionMethod: string; resolutionConfidence: number; periodStart: string; periodEnd: string;
  latestDocumentDate: string; evidenceCount: number;
};

type MetricShape = {
  id: string; companyId: string; periodId: string; sourceEvidenceId: string | null; metricKey: string; label: string;
  category: string; normalizedValue: string; displayValue: string; unit: string; context: string; confidence: number; documentDate: string;
  sourceKind: string; reviewStatus: string;
};

export function periodForDate(value: string) {
  return calendarPeriodForDate(value);
}

function bestMetric(metrics: MetricShape[], key: string) {
  return metrics.filter((item) => item.metricKey === key && item.reviewStatus !== "rejected").sort((left, right) =>
    Number(right.reviewStatus === "accepted") - Number(left.reviewStatus === "accepted")
    || Number(right.sourceKind === "xbrl") - Number(left.sourceKind === "xbrl")
    || right.documentDate.localeCompare(left.documentDate) || right.confidence - left.confidence,
  )[0];
}

export async function syncCompanyIntelligence() {
  const result = await withDatabase(async (db) => {
    const evidenceRows = await db.select().from(researchEvidence).orderBy(asc(researchEvidence.documentDate));
    const companyRows = await db.select().from(companies);
    const previousMetricRows = await db.select().from(companyMetrics);
    const previousCanonicalRows = await db.select().from(canonicalMetrics);
    const previousCanonicalMetricIds = new Set(previousCanonicalRows.map((item) => item.metricId));
    const previousMetricState = new Map(previousMetricRows.map((metric) => [metric.id, {
      reviewStatus: metric.reviewStatus, reviewNote: metric.reviewNote, reviewedByUserId: metric.reviewedByUserId, reviewedAt: metric.reviewedAt,
    }]));
    const filingRows = await db.select().from(filings);
    const irDocumentRows = await db.select().from(irDocuments);
    const irSourceDocumentRows = await db.select().from(irSourceDocuments);
    const companyFactsByCompany = new Map<string, Awaited<ReturnType<typeof fetchCompanyFacts>>>();
    if (process.env.E2E_TEST !== "1" && process.env.SEC_USER_AGENT?.trim()) {
      const userAgent = validateSecUserAgent(process.env.SEC_USER_AGENT);
      await Promise.all(companyRows.map(async (company) => {
        try {
          companyFactsByCompany.set(company.id, await fetchCompanyFacts(company.cik, userAgent));
        } catch (error) {
          console.warn(`Company Facts unavailable for ${company.ticker}:`, error instanceof Error ? error.message : error);
        }
      }));
    }
    await db.delete(reportingPeriods);

    const filingsById = new Map(filingRows.map((filing) => [filing.id, filing]));
    const documentGroups = new Map<string, {
      companyId: string; sourceKind: string; sourceDocumentId: string; sourceType: string; documentTitle: string;
      sourceUrl: string; documentDate: string; periodOfReport: string | null; extractionStatus: string | null;
      evidenceIds: string[]; excerpts: string[];
    }>();
    for (const filing of filingRows) documentGroups.set(`sec:${filing.id}`, {
      companyId: filing.companyId, sourceKind: "sec", sourceDocumentId: filing.id, sourceType: `SEC ${filing.formType}`,
      documentTitle: filing.documentTitle, sourceUrl: filing.sourceUrl, documentDate: filing.filedAt,
      periodOfReport: filing.periodOfReport, extractionStatus: null, evidenceIds: [], excerpts: [],
    });
    for (const document of irDocumentRows) documentGroups.set(`ir:${document.id}`, {
      companyId: document.companyId, sourceKind: "ir", sourceDocumentId: document.id, sourceType: document.documentType,
      documentTitle: document.title, sourceUrl: document.sourceUrl, documentDate: document.publishedAt,
      periodOfReport: null, extractionStatus: "completed", evidenceIds: [], excerpts: [],
    });
    const extractedIrUrls = new Set(irDocumentRows.map((document) => document.sourceUrl));
    for (const document of irSourceDocumentRows) {
      if (extractedIrUrls.has(document.sourceUrl)) continue;
      documentGroups.set(`ir-catalog:${document.id}`, {
        companyId: document.companyId, sourceKind: "ir-catalog", sourceDocumentId: document.id, sourceType: document.documentType,
        documentTitle: document.title, sourceUrl: document.sourceUrl, documentDate: document.publishedAt,
        periodOfReport: null, extractionStatus: document.extractionStatus, evidenceIds: [], excerpts: [],
      });
    }
    for (const evidence of evidenceRows) {
      const key = `${evidence.sourceKind}:${evidence.sourceDocumentId}`;
      const filing = evidence.sourceKind === "sec" ? filingsById.get(evidence.sourceDocumentId) : undefined;
      const group = documentGroups.get(key) ?? {
        companyId: evidence.companyId, sourceKind: evidence.sourceKind, sourceDocumentId: evidence.sourceDocumentId,
        sourceType: evidence.sourceType, documentTitle: evidence.documentTitle, sourceUrl: evidence.sourceUrl, documentDate: evidence.documentDate,
        periodOfReport: filing?.periodOfReport ?? null, extractionStatus: null, evidenceIds: [], excerpts: [],
      };
      group.evidenceIds.push(evidence.id);
      if (group.excerpts.length < 5) group.excerpts.push(evidence.excerpt);
      documentGroups.set(key, group);
    }

    const resolvedDocuments = resolveDocumentPeriods([...documentGroups.values()].map((document) => ({
      ...document, content: document.excerpts.join(" "), evidenceCount: document.evidenceIds.length,
    })));
    const resolutionByDocument = new Map(resolvedDocuments.map((document) => [`${document.sourceKind}:${document.sourceDocumentId}`, document]));
    const periodGroups = new Map<string, { companyId: string; documents: typeof resolvedDocuments; evidenceIds: string[] }>();
    for (const document of resolvedDocuments) {
      const key = `${document.companyId}:${document.periodKey}`;
      const group = periodGroups.get(key) ?? { companyId: document.companyId, documents: [], evidenceIds: [] };
      group.documents.push(document);
      group.evidenceIds.push(...(documentGroups.get(`${document.sourceKind}:${document.sourceDocumentId}`)?.evidenceIds ?? []));
      periodGroups.set(key, group);
    }

    const periods: PeriodShape[] = [];
    for (const [key, group] of periodGroups) {
      const periodKey = key.slice(group.companyId.length + 1);
      const selected = [...group.documents].sort((left, right) =>
        Number(right.fiscalQuarter !== null) - Number(left.fiscalQuarter !== null) || right.resolutionConfidence - left.resolutionConfidence,
      )[0];
      const resolutionAnchor = [...group.documents].sort(
        (left, right) => right.resolutionConfidence - left.resolutionConfidence,
      )[0];
      const calendar = periodForDate(selected.periodEnd);
      const row: PeriodShape = {
        id: `period:${group.companyId}:${periodKey}`, companyId: group.companyId, periodKey, label: selected.label,
        calendarYear: calendar.calendarYear, calendarQuarter: calendar.calendarQuarter, periodKind: selected.periodKind,
        periodBasis: group.documents.some((item) => item.periodBasis === "reported") ? "reported" : selected.periodBasis,
        fiscalYear: selected.fiscalYear, fiscalQuarter: selected.fiscalQuarter, resolutionMethod: resolutionAnchor.resolutionMethod,
        resolutionConfidence: Math.max(...group.documents.map((item) => item.resolutionConfidence)),
        periodStart: selected.periodStart, periodEnd: selected.periodEnd,
        latestDocumentDate: group.documents.map((item) => item.documentDate).sort().at(-1)!, evidenceCount: group.evidenceIds.length,
      };
      await db.insert(reportingPeriods).values(row);
      periods.push(row);

      const packageId = `package:${group.companyId}:${periodKey}`;
      await db.insert(earningsPackages).values({
        id: packageId, companyId: group.companyId, periodId: row.id, packageKey: periodKey, label: row.label,
        documentCount: group.documents.length, evidenceCount: group.evidenceIds.length,
        latestDocumentDate: row.latestDocumentDate, resolutionConfidence: row.resolutionConfidence,
      });
      await db.insert(earningsPackageDocuments).values(group.documents.map((document) => ({
        id: `package-document:${document.sourceKind}:${document.sourceDocumentId}`, packageId,
        sourceKind: document.sourceKind, sourceDocumentId: document.sourceDocumentId, sourceType: document.sourceType,
        documentTitle: document.documentTitle, sourceUrl: document.sourceUrl, publicationDate: document.documentDate, periodOfReport: document.periodOfReport ?? null,
        resolutionMethod: document.resolutionMethod, resolutionConfidence: document.resolutionConfidence,
        extractionStatus: document.extractionStatus ?? null,
        evidenceCount: document.evidenceCount,
      })));
    }

    const periodByCompanyKey = new Map(periods.map((period) => [`${period.companyId}:${period.periodKey}`, period]));
    const metrics: MetricShape[] = [];
    for (const evidence of evidenceRows) {
      const resolution = resolutionByDocument.get(`${evidence.sourceKind}:${evidence.sourceDocumentId}`);
      const period = resolution ? periodByCompanyKey.get(`${evidence.companyId}:${resolution.periodKey}`) : undefined;
      if (!period) continue;
      for (const extracted of extractMetricsFromText(evidence.excerpt)) {
        const measurementType = ["revenue", "capex", "operating_cash_flow"].includes(extracted.metricKey) ? "duration" : "instant";
        const policy = analyzeMetricObservation({
          metricKey: extracted.metricKey, normalizedValue: extracted.normalizedValue, context: extracted.context,
          measurementType, periodStart: measurementType === "duration" ? period.periodStart : null,
          periodEnd: period.periodEnd, sourceKind: "text", valueType: "reported",
        });
        const metric: MetricShape = {
          id: `metric:${evidence.id}:${extracted.metricKey}`, companyId: evidence.companyId, periodId: period.id,
          sourceEvidenceId: evidence.id, metricKey: extracted.metricKey, label: extracted.label, category: extracted.category,
          normalizedValue: String(extracted.normalizedValue), displayValue: extracted.displayValue, unit: extracted.unit,
          context: extracted.context, confidence: Math.min(evidence.sourceQuality, extracted.confidence), documentDate: evidence.documentDate,
          sourceKind: "text", reviewStatus: previousMetricState.get(`metric:${evidence.id}:${extracted.metricKey}`)?.reviewedAt
            ? previousMetricState.get(`metric:${evidence.id}:${extracted.metricKey}`)!.reviewStatus : "proposed",
        };
        const previous = previousMetricState.get(metric.id);
        await db.insert(companyMetrics).values({
          ...metric, sourceDocumentId: evidence.sourceDocumentId, sourceUrl: evidence.sourceUrl,
          sourceLabel: `${evidence.sourceType}: ${evidence.documentTitle}`, valueType: "reported",
          measurementType, scopeType: policy.scopeType, scopeLabel: policy.scopeLabel, periodType: policy.periodType,
          periodStart: measurementType === "duration" ? period.periodStart : null, anomalyFlags: policy.anomalyFlags,
          anomalyScore: policy.anomalyScore, canonicalEligible: policy.canonicalEligible,
          reviewNote: previous?.reviewNote ?? null,
          reviewedByUserId: previous?.reviewedByUserId ?? null, reviewedAt: previous?.reviewedAt ?? null,
        });
        metrics.push(metric);
      }
    }

    for (const company of companyRows) {
      const companyPeriods = periods.filter((period) => period.companyId === company.id);
      for (const fact of companyFactsByCompany.get(company.id) ?? []) {
        const period = companyPeriods.find((item) => item.periodEnd === fact.periodEnd);
        if (!period) continue;
        if (fact.measurementType === "duration" && fact.periodStart) {
          const durationDays = Math.round((Date.parse(fact.periodEnd) - Date.parse(fact.periodStart)) / 86_400_000);
          if (period.periodKind === "quarter" && (durationDays < 70 || durationDays > 110)) continue;
          if (period.periodKind === "annual" && (durationDays < 300 || durationDays > 400)) continue;
        }
        const previous = previousMetricState.get(fact.id);
        const policy = analyzeMetricObservation({
          metricKey: fact.metricKey, normalizedValue: fact.normalizedValue, context: fact.context,
          measurementType: fact.measurementType, periodStart: fact.periodStart, periodEnd: fact.periodEnd,
          sourceKind: "xbrl", valueType: "reported",
        });
        const metric: MetricShape = {
          id: fact.id, companyId: company.id, periodId: period.id, sourceEvidenceId: null,
          metricKey: fact.metricKey, label: fact.label, category: fact.category,
          normalizedValue: String(fact.normalizedValue), displayValue: fact.displayValue, unit: fact.unit,
          context: fact.context, confidence: fact.confidence, documentDate: fact.documentDate,
          sourceKind: "xbrl", reviewStatus: previous?.reviewedAt ? previous.reviewStatus : "proposed",
        };
        await db.insert(companyMetrics).values({
          ...metric, sourceDocumentId: fact.accessionNumber, sourceUrl: fact.sourceUrl,
          sourceLabel: `SEC ${fact.form} · Company Facts`, taxonomy: fact.taxonomy, concept: fact.concept,
          accessionNumber: fact.accessionNumber, valueType: "reported", measurementType: fact.measurementType,
          scopeType: policy.scopeType, scopeLabel: policy.scopeLabel, periodType: policy.periodType,
          periodStart: fact.periodStart, anomalyFlags: policy.anomalyFlags, anomalyScore: policy.anomalyScore,
          canonicalEligible: policy.canonicalEligible,
          reviewNote: previous?.reviewNote ?? null, reviewedByUserId: previous?.reviewedByUserId ?? null,
          reviewedAt: previous?.reviewedAt ?? null,
        }).onConflictDoNothing();
        metrics.push(metric);
      }
    }

    const persistedMetricRows = await db.select().from(companyMetrics);
    const canonicalRows = persistedMetricRows.filter((metric) => previousCanonicalMetricIds.has(metric.id)
      && metric.reviewStatus === "accepted");
    if (canonicalRows.length) await db.insert(canonicalMetrics).values(canonicalRows.map((metric) => ({
      id: `canonical:${metric.id}`, companyId: metric.companyId, periodId: metric.periodId,
      metricKey: metric.metricKey, scopeType: metric.scopeType, periodType: metric.periodType, metricId: metric.id,
      resolutionMethod: "analyst_review", rationale: metric.reviewNote ?? "Preserved analyst selection.",
      selectedByUserId: metric.reviewedByUserId, selectedAt: metric.reviewedAt ?? new Date(),
    }))).onConflictDoNothing();
    const canonicalMetricIds = new Set(canonicalRows.map((metric) => metric.id));

    let metricComparisons = 0;
    const orderedByCompany = new Map<string, PeriodShape[]>();
    for (const company of companyRows) orderedByCompany.set(company.id, periods.filter((period) => period.companyId === company.id).sort((a, b) => a.periodEnd.localeCompare(b.periodEnd)));
    for (const [companyId, companyPeriods] of orderedByCompany) {
      for (const [index, currentPeriod] of companyPeriods.entries()) {
        const previousPeriod = companyPeriods.slice(0, index).reverse().find((period) => period.periodKind === currentPeriod.periodKind);
        const currentMetrics = metrics.filter((metric) => metric.periodId === currentPeriod.id && canonicalMetricIds.has(metric.id));
        const previousMetrics = previousPeriod ? metrics.filter((metric) => metric.periodId === previousPeriod.id && canonicalMetricIds.has(metric.id)) : [];
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
            evidenceIds: [current.sourceEvidenceId, previous?.sourceEvidenceId].filter((id): id is string => Boolean(id)),
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
      const resolution = resolutionByDocument.get(`sec:${filing.id}`);
      const period = resolution ? periodByCompanyKey.get(`${filing.companyId}:${resolution.periodKey}`) : undefined;
      if (!period) continue;
      const companyPeriods = orderedByCompany.get(filing.companyId) ?? [];
      const periodIndex = companyPeriods.findIndex((item) => item.id === period.id);
      const previousPeriod = periodIndex > 0
        ? companyPeriods.slice(0, periodIndex).reverse().find((item) => item.periodKind === period.periodKind) ?? null
        : null;
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
    const comparisonRows = await db.select().from(periodComparisons);
    const companyById = new Map(companyRows.map((company) => [company.id, company]));
    let briefs = 0;
    for (const currentPeriod of periods) {
      const companyPeriods = orderedByCompany.get(currentPeriod.companyId) ?? [];
      const currentIndex = companyPeriods.findIndex((period) => period.id === currentPeriod.id);
      const previousPeriod = currentIndex > 0
        ? companyPeriods.slice(0, currentIndex).reverse().find((period) => period.periodKind === currentPeriod.periodKind) ?? null
        : null;
      if (!previousPeriod) continue;
      const currentComparisons = comparisonRows.filter((comparison) => comparison.currentPeriodId === currentPeriod.id);
      const brief = buildEarningsChangeBrief({
        companyName: companyById.get(currentPeriod.companyId)?.name ?? currentPeriod.companyId,
        currentLabel: currentPeriod.label,
        previousLabel: previousPeriod.label,
        periodResolutionConfidence: currentPeriod.resolutionConfidence,
        comparisons: currentComparisons.map((comparison) => ({
          id: comparison.id,
          comparisonKind: comparison.comparisonKind as BriefComparisonInput["comparisonKind"],
          category: comparison.category,
          label: comparison.label,
          direction: comparison.direction as BriefComparisonInput["direction"],
          significance: comparison.significance as BriefComparisonInput["significance"],
          summary: comparison.summary,
          evidenceIds: comparison.evidenceIds as string[],
          tone: comparison.comparisonKind === "disclosure"
            ? compareDisclosureTone(comparison.currentText ?? "", comparison.previousText ?? "")
            : "neutral",
        })),
        evidence: evidenceRows.map((evidence) => ({
          id: evidence.id, sourceQuality: evidence.sourceQuality,
          sourceDocumentId: evidence.sourceDocumentId, sourceType: evidence.sourceType,
        })),
      });
      const briefId = `change-brief:${currentPeriod.id}:${previousPeriod.id}`;
      await db.insert(earningsChangeBriefs).values({
        id: briefId, companyId: currentPeriod.companyId, currentPeriodId: currentPeriod.id,
        previousPeriodId: previousPeriod.id, headline: brief.headline, summary: brief.summary,
        thesisImpact: brief.thesisImpact, confidenceScore: brief.confidenceScore,
        evidenceQualityScore: brief.evidenceQualityScore, sourceDiversityScore: brief.sourceDiversityScore,
        changeCount: brief.changeCount,
      });
      if (brief.claims.length) await db.insert(earningsChangeBriefClaims).values(brief.claims.map((claim, ordinal) => ({
        id: `${briefId}:claim:${ordinal + 1}`, briefId, ordinal, section: claim.section, title: claim.title,
        text: claim.text, sentiment: claim.sentiment, significance: claim.significance,
        comparisonId: claim.comparisonId, evidenceIds: claim.evidenceIds,
      })));
      const contentHash = createHash("sha256").update(JSON.stringify(brief)).digest("hex").slice(0, 20);
      await db.insert(earningsChangeBriefVersions).values({
        id: `change-brief-version:${currentPeriod.companyId}:${currentPeriod.periodKey}:${previousPeriod.periodKey}:${contentHash}`,
        companyId: currentPeriod.companyId, currentPeriodKey: currentPeriod.periodKey,
        currentPeriodLabel: currentPeriod.label, previousPeriodKey: previousPeriod.periodKey,
        previousPeriodLabel: previousPeriod.label, thesisImpact: brief.thesisImpact,
        confidenceScore: brief.confidenceScore, contentHash, snapshot: brief,
      }).onConflictDoNothing();
      briefs += 1;
    }
    return { periods: periods.length, packages: periods.length, documents: resolvedDocuments.length, metrics: metrics.length, metricComparisons, disclosureComparisons, briefs };
  });
  if (!result) throw new Error("Company intelligence requires a configured database.");
  const conflicts = await rebuildMetricConflicts();
  return { ...result, conflicts: conflicts.open };
}

function toEvidenceItem(evidence: typeof researchEvidence.$inferSelect, company: typeof companies.$inferSelect): ResearchEvidenceItem {
  return {
    id: evidence.id, companyId: company.id, companyName: company.name, ticker: company.ticker,
    sourceKind: evidence.sourceKind as ResearchEvidenceItem["sourceKind"], sourceDocumentId: evidence.sourceDocumentId,
    sourcePassageId: evidence.sourcePassageId, sourceType: evidence.sourceType, documentTitle: evidence.documentTitle,
    documentDate: evidence.documentDate, sectionTitle: evidence.sectionTitle, topic: evidence.topic, excerpt: evidence.excerpt,
    sourceUrl: evidence.sourceUrl, pageNumber: evidence.pageNumber, sourceQuality: evidence.sourceQuality, contentHash: evidence.contentHash,
    evidenceQualityScore: evidence.evidenceQualityScore, materialityScore: evidence.materialityScore,
    specificityScore: evidence.specificityScore, relevanceScore: evidence.relevanceScore, boilerplateRisk: evidence.boilerplateRisk,
    qualityReasons: evidence.qualityReasons as string[], duplicateGroupId: evidence.duplicateGroupId, duplicateCount: evidence.duplicateCount,
    suggestedClaimId: evidence.suggestedClaimId, suggestedClaimTitle: null,
    suggestedImpact: evidence.suggestedImpact as ResearchEvidenceItem["suggestedImpact"], suggestionConfidence: evidence.suggestionConfidence,
    suggestionRationale: evidence.suggestionRationale, suggestionStatus: evidence.suggestionStatus as ResearchEvidenceItem["suggestionStatus"],
    qualityScoredAt: evidence.qualityScoredAt?.toISOString() ?? null,
    reviewStatus: evidence.reviewStatus as ResearchEvidenceItem["reviewStatus"], reviewNote: evidence.reviewNote,
    reviewedAt: evidence.reviewedAt?.toISOString() ?? null,
  };
}

function toPeriod(row: typeof reportingPeriods.$inferSelect): IntelligencePeriod {
  return {
    id: row.id, periodKey: row.periodKey, label: row.label, periodStart: row.periodStart, periodEnd: row.periodEnd,
    latestDocumentDate: row.latestDocumentDate, evidenceCount: row.evidenceCount,
    periodKind: row.periodKind as IntelligencePeriod["periodKind"], periodBasis: row.periodBasis as IntelligencePeriod["periodBasis"],
    fiscalYear: row.fiscalYear, fiscalQuarter: row.fiscalQuarter, resolutionMethod: row.resolutionMethod,
    resolutionConfidence: row.resolutionConfidence,
  };
}

export async function getCompanyIntelligence(companyId?: string, currentPeriodId?: string, previousPeriodId?: string): Promise<CompanyIntelligenceResponse> {
  const result = await withDatabase(async (db) => {
    const companyRows = await db.select().from(companies).orderBy(asc(companies.name));
    const allPeriods = await db.select().from(reportingPeriods).orderBy(desc(reportingPeriods.periodEnd));
    const selectedCompany = companyRows.find((company) => company.id === companyId) ?? companyRows.find((company) => allPeriods.some((period) => period.companyId === company.id));
    if (!selectedCompany) throw new Error("No company intelligence is available yet. Run the intelligence sync first.");
    const periods = allPeriods.filter((period) => period.companyId === selectedCompany.id);
    const companyMetricRows = await db.select().from(companyMetrics).where(eq(companyMetrics.companyId, selectedCompany.id));
    const companyCanonicalRows = await db.select().from(canonicalMetrics).where(eq(canonicalMetrics.companyId, selectedCompany.id));
    const canonicalMetricIds = new Set(companyCanonicalRows.map((metric) => metric.metricId));
    const canonicalCompanyMetricRows = companyMetricRows.filter((metric) => canonicalMetricIds.has(metric.id));
    const metricPeriodIds = new Set(canonicalCompanyMetricRows.map((metric) => metric.periodId));
    const current = periods.find((period) => period.id === currentPeriodId)
      ?? periods.find((period) => metricPeriodIds.has(period.id) && period.periodKind === "quarter" && period.periodBasis !== "calendar-fallback")
      ?? periods.find((period) => period.periodKind === "quarter" && period.periodBasis !== "calendar-fallback")
      ?? periods[0];
    if (!current) throw new Error("This company has no reporting periods yet.");
    const currentIndex = periods.findIndex((period) => period.id === current.id);
    const previous = periods.find((period) => period.id === previousPeriodId && period.periodKind === current.periodKind)
      ?? periods.slice(currentIndex + 1).find((period) => period.periodKind === current.periodKind)
      ?? null;
    const comparisons = await db.select().from(periodComparisons).where(eq(periodComparisons.currentPeriodId, current.id)).orderBy(desc(periodComparisons.significance), asc(periodComparisons.category));
    const disclosures = comparisons.filter((item) => item.comparisonKind === "disclosure");
    const currentMetricRows = canonicalCompanyMetricRows.filter((metric) => metric.periodId === current.id);
    const previousMetricRows = previous ? canonicalCompanyMetricRows.filter((metric) => metric.periodId === previous.id) : [];
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
        evidenceIds: [currentMetric.sourceEvidenceId, previousMetric?.sourceEvidenceId].filter((id): id is string => Boolean(id)),
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
    const briefRows = await db.select().from(earningsChangeBriefs).where(eq(earningsChangeBriefs.currentPeriodId, current.id));
    const briefRow = briefRows.find((item) => item.previousPeriodId === (previous?.id ?? null));
    const briefClaims = briefRow
      ? await db.select().from(earningsChangeBriefClaims).where(eq(earningsChangeBriefClaims.briefId, briefRow.id)).orderBy(asc(earningsChangeBriefClaims.ordinal))
      : [];
    const briefVersionRows = briefRow && previous
      ? (await db.select().from(earningsChangeBriefVersions).where(eq(earningsChangeBriefVersions.companyId, selectedCompany.id)).orderBy(desc(earningsChangeBriefVersions.generatedAt)))
        .filter((item) => item.currentPeriodKey === current.periodKey && item.previousPeriodKey === previous.periodKey)
      : [];
    const packageRows = await db.select().from(earningsPackages).where(eq(earningsPackages.periodId, current.id)).limit(1);
    const packageRow = packageRows[0];
    const packageDocuments = packageRow
      ? await db.select().from(earningsPackageDocuments).where(eq(earningsPackageDocuments.packageId, packageRow.id)).orderBy(desc(earningsPackageDocuments.publicationDate))
      : [];
    return {
      companies: companyRows.map((company) => {
        const companyPeriods = allPeriods.filter((period) => period.companyId === company.id);
        const latest = companyPeriods.find((period) => period.periodKind === "quarter" && period.periodBasis !== "calendar-fallback") ?? companyPeriods[0];
        return { id: company.id, name: company.name, ticker: company.ticker, periodCount: companyPeriods.length, latestPeriod: latest?.label ?? null };
      }).filter((company) => company.periodCount > 0),
      company: { id: selectedCompany.id, name: selectedCompany.name, ticker: selectedCompany.ticker }, periods: periods.map(toPeriod),
      currentPeriod: toPeriod(current), previousPeriod: previous ? toPeriod(previous) : null, comparisons: mapped, evidence,
      changeBrief: briefRow ? {
        id: briefRow.id, headline: briefRow.headline, summary: briefRow.summary,
        thesisImpact: briefRow.thesisImpact as EarningsChangeBrief["thesisImpact"],
        confidenceScore: briefRow.confidenceScore, evidenceQualityScore: briefRow.evidenceQualityScore,
        sourceDiversityScore: briefRow.sourceDiversityScore, changeCount: briefRow.changeCount,
        engine: briefRow.engine, generatedAt: briefRow.generatedAt.toISOString(),
        versionHistory: briefVersionRows.map((version) => ({
          id: version.id, thesisImpact: version.thesisImpact as EarningsChangeBrief["thesisImpact"],
          confidenceScore: version.confidenceScore, generatedAt: version.generatedAt.toISOString(),
        })),
        sections: ([
          ["change", "What changed"], ["bull", "Bull implications"], ["bear", "Bear implications"], ["question", "Open questions"],
        ] as const).map(([key, title]) => ({
          key, title, claims: briefClaims.filter((claim) => claim.section === key).map((claim) => ({
            id: claim.id, section: key, title: claim.title, text: claim.text,
            sentiment: claim.sentiment as "positive" | "negative" | "neutral" | "open",
            significance: claim.significance as "high" | "medium" | "low",
            comparisonId: claim.comparisonId, evidenceIds: claim.evidenceIds as string[],
          })),
        })),
      } : null,
      earningsPackage: packageRow ? {
        id: packageRow.id, label: packageRow.label, documentCount: packageRow.documentCount, evidenceCount: packageRow.evidenceCount,
        documents: packageDocuments.map((document) => ({
          id: document.id, sourceKind: document.sourceKind, sourceDocumentId: document.sourceDocumentId,
          sourceType: document.sourceType, documentTitle: document.documentTitle, sourceUrl: document.sourceUrl, publicationDate: document.publicationDate,
          periodOfReport: document.periodOfReport, resolutionMethod: document.resolutionMethod,
          resolutionConfidence: document.resolutionConfidence, extractionStatus: document.extractionStatus,
          evidenceCount: document.evidenceCount,
        })),
      } : null,
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
