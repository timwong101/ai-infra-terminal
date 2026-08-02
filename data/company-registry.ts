export type IssuerReportingRegime = {
  classification: "domestic" | "foreign-private";
  effectiveFrom: string;
  effectiveTo?: string;
  forms: string[];
};

export type CompanyRegistryEntry = {
  id: string;
  name: string;
  ticker: string;
  cik: string;
  fiscalYearEndMonth: number;
  forms: string[];
  regimes: IssuerReportingRegime[];
  eventAliases: string[];
  ir: {
    pages: string[];
    allowedHosts: string[];
    includePathFragments: string[];
    catalogOnlyHosts?: string[];
  };
};

export const COMPANY_REGISTRY: readonly CompanyRegistryEntry[] = [
  {
    id: "coreweave", name: "CoreWeave", ticker: "CRWV", cik: "0001769628", fiscalYearEndMonth: 12,
    forms: ["10-K", "10-Q", "8-K"], eventAliases: ["CoreWeave"],
    regimes: [{ classification: "domestic", effectiveFrom: "0000-01-01", forms: ["10-K", "10-Q", "8-K"] }],
    ir: { pages: ["https://investors.coreweave.com/rss/pressrelease.aspx"], allowedHosts: ["investors.coreweave.com", "coreweave2025ipo.q4web.com", "s205.q4cdn.com"], includePathFragments: ["/news/news-details/", "/files/doc_financials/", "/files/doc_presentations/"] },
  },
  {
    id: "nebius", name: "Nebius", ticker: "NBIS", cik: "0001513845", fiscalYearEndMonth: 12,
    forms: ["20-F", "20-F/A", "6-K"], eventAliases: ["Nebius"],
    regimes: [{ classification: "foreign-private", effectiveFrom: "0000-01-01", forms: ["20-F", "20-F/A", "6-K"] }],
    ir: { pages: ["https://nebius.com/financials", "https://nebius.com/newsroom"], allowedHosts: ["nebius.com", "assets.nebius.com"], includePathFragments: ["/newsroom/", "/assets/"] },
  },
  {
    id: "applied-digital", name: "Applied Digital", ticker: "APLD", cik: "0001144879", fiscalYearEndMonth: 5,
    forms: ["10-K", "10-Q", "8-K"], eventAliases: ["Applied Digital"],
    regimes: [{ classification: "domestic", effectiveFrom: "0000-01-01", forms: ["10-K", "10-Q", "8-K"] }],
    ir: { pages: ["https://ir.applieddigital.com/news-events", "https://ir.applieddigital.com/news-events/presentations"], allowedHosts: ["ir.applieddigital.com"], includePathFragments: ["/news-events/press-releases/detail/", "/_assets/"] },
  },
  {
    id: "iren", name: "IREN", ticker: "IREN", cik: "0001878848", fiscalYearEndMonth: 6,
    forms: ["10-K", "10-Q", "8-K", "20-F", "20-F/A", "6-K"], eventAliases: ["IREN", "Iris Energy"],
    regimes: [
      { classification: "foreign-private", effectiveFrom: "0000-01-01", effectiveTo: "2025-06-30", forms: ["20-F", "20-F/A", "6-K"] },
      { classification: "domestic", effectiveFrom: "2025-07-01", forms: ["10-K", "10-Q", "8-K"] },
    ],
    ir: { pages: ["https://iren.com/investors/news", "https://iren.com/investors/reports"], allowedHosts: ["iren.com", "www.iren.com", "iren.gcs-web.com"], includePathFragments: ["/static-files/", "/investors/news/", "/investors/reports/"], catalogOnlyHosts: ["iren.gcs-web.com"] },
  },
] as const;

export const TRACKED_COMPANY_SUMMARIES = COMPANY_REGISTRY.map(({ id, name, ticker }) => ({ id, name, ticker }));
