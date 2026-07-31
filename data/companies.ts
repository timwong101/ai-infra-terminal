export type SecCompany = {
  id: string;
  name: string;
  ticker: string;
  cik: string;
  fiscalYearEndMonth?: number;
  forms: string[];
  regimes: IssuerReportingRegime[];
};

export type IssuerReportingRegime = {
  classification: "domestic" | "foreign-private";
  effectiveFrom: string;
  effectiveTo?: string;
  forms: string[];
};

export function getIssuerRegime(company: SecCompany, filingDate: string) {
  return company.regimes.find((regime) =>
    filingDate >= regime.effectiveFrom && (!regime.effectiveTo || filingDate <= regime.effectiveTo),
  ) ?? null;
}

export function isFormAllowedForDate(company: SecCompany, formType: string, filingDate: string) {
  return getIssuerRegime(company, filingDate)?.forms.includes(formType) ?? false;
}

export const secCompanies: SecCompany[] = [
  {
    id: "coreweave",
    name: "CoreWeave",
    ticker: "CRWV",
    cik: "0001769628",
    fiscalYearEndMonth: 12,
    forms: ["10-K", "10-Q", "8-K"],
    regimes: [{ classification: "domestic", effectiveFrom: "0000-01-01", forms: ["10-K", "10-Q", "8-K"] }],
  },
  {
    id: "nebius",
    name: "Nebius",
    ticker: "NBIS",
    cik: "0001513845",
    fiscalYearEndMonth: 12,
    forms: ["20-F", "20-F/A", "6-K"],
    regimes: [{ classification: "foreign-private", effectiveFrom: "0000-01-01", forms: ["20-F", "20-F/A", "6-K"] }],
  },
  {
    id: "applied-digital",
    name: "Applied Digital",
    ticker: "APLD",
    cik: "0001144879",
    fiscalYearEndMonth: 5,
    forms: ["10-K", "10-Q", "8-K"],
    regimes: [{ classification: "domestic", effectiveFrom: "0000-01-01", forms: ["10-K", "10-Q", "8-K"] }],
  },
  {
    id: "iren",
    name: "IREN",
    ticker: "IREN",
    cik: "0001878848",
    fiscalYearEndMonth: 6,
    forms: ["10-K", "10-Q", "8-K", "20-F", "20-F/A", "6-K"],
    regimes: [
      { classification: "foreign-private", effectiveFrom: "0000-01-01", effectiveTo: "2025-06-30", forms: ["20-F", "20-F/A", "6-K"] },
      { classification: "domestic", effectiveFrom: "2025-07-01", forms: ["10-K", "10-Q", "8-K"] },
    ],
  },
];
