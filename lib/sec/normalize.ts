import { getIssuerRegime, isFormAllowedForDate, type SecCompany } from "@/data/companies";
import type { EvidenceEvent } from "@/lib/evidence/types";
import type { SecSubmissionsResponse } from "@/lib/sec/types";

const FORM_SUMMARIES: Record<string, string> = {
  "10-K": "Annual operating, liquidity, customer concentration, and risk disclosures",
  "10-Q": "Quarterly results, backlog, liquidity, and risk disclosures",
  "8-K": "Material agreement, financing, operating update, or other current event",
  "20-F": "Annual operating, liquidity, customer concentration, and risk disclosures",
  "20-F/A": "Amendment to annual operating and risk disclosures",
  "6-K": "Foreign issuer operating, financing, or strategic update",
};

const FORM_QUALITY: Record<string, number> = {
  "10-K": 94,
  "10-Q": 92,
  "8-K": 86,
  "20-F": 94,
  "20-F/A": 90,
  "6-K": 86,
};

export function buildSecArchiveUrl(
  cik: string,
  accessionNumber: string,
  primaryDocument: string,
) {
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNumber.replaceAll("-", "")}/${primaryDocument}`;
}

export function findUnexpectedIssuerForms(
  company: SecCompany,
  submissions: SecSubmissionsResponse,
  cutoffDate: string,
) {
  const recent = submissions.filings.recent;
  return recent.form.flatMap((formType, index) => {
    const filedAt = recent.filingDate[index];
    if (!company.forms.includes(formType) || filedAt < cutoffDate || isFormAllowedForDate(company, formType, filedAt)) return [];
    return [{
      companyId: company.id,
      formType,
      filedAt,
      message: `${formType} falls outside ${company.name}'s reporting regime on ${filedAt}.`,
    }];
  });
}

export function normalizeSecSubmissions(
  company: SecCompany,
  submissions: SecSubmissionsResponse,
  fetchedAt: string,
  cutoffDate: string,
): EvidenceEvent[] {
  const recent = submissions.filings.recent;

  return recent.form
    .map((formType, index) => ({
      formType,
      accessionNumber: recent.accessionNumber[index],
      filedAt: recent.filingDate[index],
      acceptedAt: recent.acceptanceDateTime[index],
      periodOfReport: recent.reportDate[index] || null,
      primaryDocument: recent.primaryDocument[index],
      description: recent.primaryDocDescription[index],
    }))
    .filter(
      (filing) =>
        isFormAllowedForDate(company, filing.formType, filing.filedAt) &&
        filing.filedAt >= cutoffDate &&
        Boolean(filing.accessionNumber && filing.primaryDocument),
    )
    .map((filing) => ({
      id: `sec:${company.cik}:${filing.accessionNumber}`,
      companyId: company.id,
      companyName: company.name,
      ticker: company.ticker,
      cik: company.cik,
      theme: "Neoclouds" as const,
      sourceType: "SEC" as const,
      formType: filing.formType,
      filedAt: filing.filedAt,
      acceptedAt: filing.acceptedAt,
      periodOfReport: filing.periodOfReport,
      headline: `${company.name} filed ${filing.formType}`,
      summary: FORM_SUMMARIES[filing.formType] ?? filing.description ?? "New regulatory filing",
      accessionNumber: filing.accessionNumber,
      primaryDocument: filing.primaryDocument,
      sourceUrl: buildSecArchiveUrl(company.cik, filing.accessionNumber, filing.primaryDocument),
      fetchedAt,
      sourceQuality: FORM_QUALITY[filing.formType] ?? 82,
      signal: "neutral" as const,
      issuerClassification: getIssuerRegime(company, filing.filedAt)?.classification ?? "domestic",
    }))
    .sort((left, right) => right.filedAt.localeCompare(left.filedAt));
}
