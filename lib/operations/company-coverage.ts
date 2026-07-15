import { secCompanies } from "@/data/companies";
import { withDatabase } from "@/lib/db/client";
import {
  earningsChangeBriefs,
  filings,
  irDocuments,
  irSourceDocuments,
  periodComparisons,
  reportingPeriods,
  researchAlerts,
  researchClaims,
  researchEvidence,
} from "@/lib/db/schema";

export type CompanyFlowCoverage = {
  company: { id: string; name: string; ticker: string };
  counts: { sec: number; irCatalog: number; irDocuments: number; evidence: number; accepted: number; alerts: number; claims: number; comparableQuarters: number; comparisons: number; briefs: number };
  flows: { ingestion: boolean; evidence: boolean; alerts: boolean; theses: boolean; intelligence: boolean; memos: boolean };
  ready: boolean;
  gaps: string[];
};

export function buildCompanyFlowCoverage(
  company: { id: string; name: string; ticker: string },
  counts: CompanyFlowCoverage["counts"],
): CompanyFlowCoverage {
  const flows = {
    ingestion: counts.sec > 0 && counts.irCatalog > 0 && counts.irDocuments > 0,
    evidence: counts.evidence > 0,
    alerts: counts.alerts > 0,
    theses: counts.claims >= 5,
    intelligence: counts.comparableQuarters >= 2 && counts.comparisons > 0 && counts.briefs > 0,
    memos: counts.accepted >= 1,
  };
  const gaps = Object.entries(flows).flatMap(([flow, ready]) => ready ? [] : [flow]);
  return { company, counts, flows, ready: gaps.length === 0, gaps };
}

export async function getCompanyFlowCoverage(): Promise<CompanyFlowCoverage[]> {
  const result = await withDatabase(async (db) => {
    const [filingRows, catalogRows, documentRows, evidenceRows, alertRows, claimRows, periodRows, comparisonRows, briefRows] = await Promise.all([
      db.select().from(filings), db.select().from(irSourceDocuments), db.select().from(irDocuments),
      db.select().from(researchEvidence), db.select().from(researchAlerts), db.select().from(researchClaims),
      db.select().from(reportingPeriods), db.select().from(periodComparisons), db.select().from(earningsChangeBriefs),
    ]);
    return secCompanies.map((company) => {
      const accepted = evidenceRows.filter((item) => item.companyId === company.id && item.reviewStatus === "accepted").length;
      const comparableQuarters = periodRows.filter((item) => item.companyId === company.id && item.periodKind === "quarter" && item.periodBasis !== "calendar-fallback").length;
      const counts = {
        sec: filingRows.filter((item) => item.companyId === company.id).length,
        irCatalog: catalogRows.filter((item) => item.companyId === company.id).length,
        irDocuments: documentRows.filter((item) => item.companyId === company.id).length,
        evidence: evidenceRows.filter((item) => item.companyId === company.id).length,
        accepted,
        alerts: alertRows.filter((item) => item.companyId === company.id).length,
        claims: claimRows.filter((item) => item.companyId === company.id).length,
        comparableQuarters,
        comparisons: comparisonRows.filter((item) => item.companyId === company.id).length,
        briefs: briefRows.filter((item) => item.companyId === company.id).length,
      };
      return buildCompanyFlowCoverage({ id: company.id, name: company.name, ticker: company.ticker }, counts);
    });
  });
  if (!result) throw new Error("Company coverage requires a configured database.");
  return result;
}
