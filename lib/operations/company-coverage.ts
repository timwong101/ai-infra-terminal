import { secCompanies } from "@/data/companies";
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
    const [filingRows, catalogRows, documentRows, evidenceRows, reviewRows, alertRows, claimRows, periodRows, comparisonRows, briefRows, packageRows, packageDocumentRows, memoRows] = await Promise.all([
      db.select().from(filings), db.select().from(irSourceDocuments), db.select().from(irDocuments),
      db.select().from(researchEvidence), db.select().from(workspaceEvidenceReviews), db.select().from(researchAlerts), db.select().from(researchClaims),
      db.select().from(reportingPeriods), db.select().from(periodComparisons), db.select().from(earningsChangeBriefs),
      db.select().from(earningsPackages), db.select().from(earningsPackageDocuments), db.select().from(comparisonMemos),
    ]);
    const reviewByEvidenceId = new Map(reviewRows.filter((item) => item.workspaceId === workspaceId).map((item) => [item.evidenceId, item]));
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
        sec: filingRows.filter((item) => item.companyId === company.id).length,
        irCatalog: catalogRows.filter((item) => item.companyId === company.id).length,
        irDocuments: documentRows.filter((item) => item.companyId === company.id).length,
        evidence: evidenceRows.filter((item) => item.companyId === company.id).length,
        accepted: acceptedEvidence.length,
        alerts: alertRows.filter((item) => item.companyId === company.id).length,
        claims: claimRows.filter((item) => item.companyId === company.id).length,
        comparableQuarters: companyQuarters.length,
        comparisons: comparisonRows.filter((item) => item.companyId === company.id).length,
        briefs: briefRows.filter((item) => item.companyId === company.id).length,
        memos: memoRows.filter((item) => item.workspaceId === workspaceId && (item.companyAId === company.id || item.companyBId === company.id)).length,
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
