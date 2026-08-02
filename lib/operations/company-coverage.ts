import { secCompanies } from "@/data/companies";
import { count, desc, eq, inArray } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import {
  earningsChangeBriefs,
  earningsPackageDocuments,
  earningsPackages,
  comparisonMemos,
  filings,
  irDocuments,
  irSourceDocuments,
  periodComparisons,
  reportingPeriods,
  researchAlerts,
  researchClaims,
  researchEvidence,
  workspaceEvidenceReviews,
} from "@/lib/db/schema";

export type CompanyFlowCoverage = {
  company: { id: string; name: string; ticker: string };
  counts: {
    sec: number; irCatalog: number; irDocuments: number; evidence: number; accepted: number; alerts: number; claims: number;
    comparableQuarters: number; comparisons: number; briefs: number; memos: number;
    latestPackageDocuments: number; latestPackageEvidence: number; latestAcceptedEvidence: number;
    latestGroundedComparisons: number; latestReadyBriefs: number;
  };
  currentPeriod: { id: string; label: string } | null;
  flows: { ingestion: boolean; evidence: boolean; alerts: boolean; theses: boolean; intelligence: boolean; memos: boolean };
  ready: boolean;
  gaps: string[];
};

export function buildCompanyFlowCoverage(
  company: { id: string; name: string; ticker: string },
  counts: CompanyFlowCoverage["counts"],
  currentPeriod: CompanyFlowCoverage["currentPeriod"] = null,
): CompanyFlowCoverage {
  const flows = {
    ingestion: counts.sec > 0 && counts.irCatalog > 0 && counts.irDocuments > 0,
    evidence: Boolean(currentPeriod) && counts.latestPackageDocuments > 0 && counts.latestPackageEvidence > 0 && counts.latestAcceptedEvidence > 0,
    alerts: counts.alerts > 0,
    theses: counts.claims >= 5,
    intelligence: counts.comparableQuarters >= 2 && counts.latestGroundedComparisons > 0 && counts.latestReadyBriefs > 0,
    memos: counts.memos > 0,
  };
  const gaps = Object.entries(flows).flatMap(([flow, ready]) => ready ? [] : [flow]);
  return { company, counts, currentPeriod, flows, ready: gaps.length === 0, gaps };
}

export async function getCompanyFlowCoverage(workspaceId: string): Promise<CompanyFlowCoverage[]> {
  const result = await withDatabase(async (db) => {
    const companyIds = secCompanies.map((company) => company.id);
    const groupedCount = async (table: typeof filings | typeof irSourceDocuments | typeof irDocuments | typeof researchAlerts | typeof researchClaims) =>
      db.select({ companyId: table.companyId, count: count() }).from(table).where(inArray(table.companyId, companyIds)).groupBy(table.companyId);
    const [filingCounts, catalogCounts, documentCounts, alertCounts, claimCounts, periodRows, evidenceRows, reviewRows, memoRows] = await Promise.all([
      groupedCount(filings), groupedCount(irSourceDocuments), groupedCount(irDocuments), groupedCount(researchAlerts), groupedCount(researchClaims),
      db.select({ id: reportingPeriods.id, companyId: reportingPeriods.companyId, label: reportingPeriods.label, periodEnd: reportingPeriods.periodEnd, periodKind: reportingPeriods.periodKind, periodBasis: reportingPeriods.periodBasis })
        .from(reportingPeriods).where(inArray(reportingPeriods.companyId, companyIds)).orderBy(desc(reportingPeriods.periodEnd)),
      db.select({ id: researchEvidence.id, companyId: researchEvidence.companyId, sourceKind: researchEvidence.sourceKind, sourceDocumentId: researchEvidence.sourceDocumentId, evidenceQualityScore: researchEvidence.evidenceQualityScore, boilerplateRisk: researchEvidence.boilerplateRisk })
        .from(researchEvidence).where(inArray(researchEvidence.companyId, companyIds)),
      db.select({ evidenceId: workspaceEvidenceReviews.evidenceId, reviewStatus: workspaceEvidenceReviews.reviewStatus }).from(workspaceEvidenceReviews).where(eq(workspaceEvidenceReviews.workspaceId, workspaceId)),
      db.select({ companyAId: comparisonMemos.companyAId, companyBId: comparisonMemos.companyBId }).from(comparisonMemos).where(eq(comparisonMemos.workspaceId, workspaceId)),
    ]);
    const currentPeriods = companyIds.flatMap((companyId) => periodRows.find((item) => item.companyId === companyId && item.periodKind === "quarter" && item.periodBasis !== "calendar-fallback") ?? []);
    const currentPeriodIds = currentPeriods.map((item) => item.id);
    const [comparisonRows, briefRows, packageRows] = currentPeriodIds.length ? await Promise.all([
      db.select({ companyId: periodComparisons.companyId, currentPeriodId: periodComparisons.currentPeriodId, evidenceIds: periodComparisons.evidenceIds }).from(periodComparisons).where(inArray(periodComparisons.currentPeriodId, currentPeriodIds)),
      db.select({ companyId: earningsChangeBriefs.companyId, currentPeriodId: earningsChangeBriefs.currentPeriodId, readinessStatus: earningsChangeBriefs.readinessStatus }).from(earningsChangeBriefs).where(inArray(earningsChangeBriefs.currentPeriodId, currentPeriodIds)),
      db.select({ id: earningsPackages.id, periodId: earningsPackages.periodId, evidenceCount: earningsPackages.evidenceCount }).from(earningsPackages).where(inArray(earningsPackages.periodId, currentPeriodIds)),
    ]) : [[], [], []];
    const packageIds = packageRows.map((item) => item.id);
    const packageDocumentRows = packageIds.length
      ? await db.select({ packageId: earningsPackageDocuments.packageId, sourceKind: earningsPackageDocuments.sourceKind, sourceDocumentId: earningsPackageDocuments.sourceDocumentId }).from(earningsPackageDocuments).where(inArray(earningsPackageDocuments.packageId, packageIds))
      : [];
    const countByCompany = (rows: Array<{ companyId: string; count: number }>, companyId: string) => Number(rows.find((item) => item.companyId === companyId)?.count ?? 0);
    const reviewByEvidenceId = new Map(reviewRows.map((item) => [item.evidenceId, item]));
    return secCompanies.map((company) => {
      const acceptedEvidence = evidenceRows.filter((item) => item.companyId === company.id && reviewByEvidenceId.get(item.id)?.reviewStatus === "accepted" && item.evidenceQualityScore >= 45 && item.boilerplateRisk < 60);
      const companyQuarters = periodRows.filter((item) => item.companyId === company.id && item.periodKind === "quarter" && item.periodBasis !== "calendar-fallback").sort((left, right) => right.periodEnd.localeCompare(left.periodEnd));
      const currentPeriod = companyQuarters[0] ?? null;
      const currentPackage = currentPeriod ? packageRows.find((item) => item.periodId === currentPeriod.id) : null;
      const currentPackageDocuments = currentPackage ? packageDocumentRows.filter((item) => item.packageId === currentPackage.id) : [];
      const currentDocumentKeys = new Set(currentPackageDocuments.map((item) => `${item.sourceKind}:${item.sourceDocumentId}`));
      const currentAccepted = acceptedEvidence.filter((item) => currentDocumentKeys.has(`${item.sourceKind}:${item.sourceDocumentId}`));
      const currentComparisons = currentPeriod ? comparisonRows.filter((item) => item.currentPeriodId === currentPeriod.id) : [];
      const groundedComparisons = currentComparisons.filter((item) => (item.evidenceIds as string[]).some((id) => currentAccepted.some((evidence) => evidence.id === id)));
      const currentBriefs = currentPeriod ? briefRows.filter((item) => item.currentPeriodId === currentPeriod.id) : [];
      const counts = {
        sec: countByCompany(filingCounts, company.id),
        irCatalog: countByCompany(catalogCounts, company.id),
        irDocuments: countByCompany(documentCounts, company.id),
        evidence: evidenceRows.filter((item) => item.companyId === company.id).length,
        accepted: acceptedEvidence.length,
        alerts: countByCompany(alertCounts, company.id),
        claims: countByCompany(claimCounts, company.id),
        comparableQuarters: companyQuarters.length,
        comparisons: comparisonRows.filter((item) => item.companyId === company.id).length,
        briefs: briefRows.filter((item) => item.companyId === company.id).length,
        memos: memoRows.filter((item) => item.companyAId === company.id || item.companyBId === company.id).length,
        latestPackageDocuments: currentPackageDocuments.length,
        latestPackageEvidence: currentPackage?.evidenceCount ?? 0,
        latestAcceptedEvidence: currentAccepted.length,
        latestGroundedComparisons: groundedComparisons.length,
        latestReadyBriefs: currentBriefs.filter((item) => item.readinessStatus === "ready").length,
      };
      return buildCompanyFlowCoverage({ id: company.id, name: company.name, ticker: company.ticker }, counts, currentPeriod ? { id: currentPeriod.id, label: currentPeriod.label } : null);
    });
  });
  if (!result) throw new Error("Company coverage requires a configured database.");
  return result;
}
