import { COMPANY_REGISTRY, type CompanyRegistryEntry, type IssuerReportingRegime } from "@/data/company-registry";

export type SecCompany = Omit<CompanyRegistryEntry, "eventAliases" | "ir" | "fiscalYearEndMonth"> & { fiscalYearEndMonth?: number };
export type { IssuerReportingRegime };

export function getIssuerRegime(company: SecCompany, filingDate: string) {
  return company.regimes.find((regime) =>
    filingDate >= regime.effectiveFrom && (!regime.effectiveTo || filingDate <= regime.effectiveTo),
  ) ?? null;
}

export function isFormAllowedForDate(company: SecCompany, formType: string, filingDate: string) {
  return getIssuerRegime(company, filingDate)?.forms.includes(formType) ?? false;
}

export const secCompanies: SecCompany[] = COMPANY_REGISTRY.map(({ id, name, ticker, cik, fiscalYearEndMonth, forms, regimes }) => ({
  id,
  name,
  ticker,
  cik,
  fiscalYearEndMonth,
  forms,
  regimes,
}));
