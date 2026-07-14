export type IrSourceConfig = {
  companyId: string;
  companyName: string;
  ticker: string;
  pages: string[];
  allowedHosts: string[];
  includePathFragments: string[];
};

export const irSources: IrSourceConfig[] = [
  {
    companyId: "coreweave",
    companyName: "CoreWeave",
    ticker: "CRWV",
    pages: ["https://investors.coreweave.com/rss/pressrelease.aspx"],
    allowedHosts: ["investors.coreweave.com", "coreweave2025ipo.q4web.com", "s205.q4cdn.com"],
    includePathFragments: ["/news/news-details/", "/files/doc_financials/", "/files/doc_presentations/"],
  },
  {
    companyId: "nebius",
    companyName: "Nebius",
    ticker: "NBIS",
    pages: ["https://nebius.com/financials", "https://nebius.com/newsroom"],
    allowedHosts: ["nebius.com", "assets.nebius.com"],
    includePathFragments: ["/newsroom/", "/assets/"],
  },
  {
    companyId: "applied-digital",
    companyName: "Applied Digital",
    ticker: "APLD",
    pages: [
      "https://ir.applieddigital.com/news-events",
      "https://ir.applieddigital.com/news-events/presentations",
    ],
    allowedHosts: ["ir.applieddigital.com"],
    includePathFragments: ["/news-events/press-releases/detail/", "/_assets/"],
  },
  {
    companyId: "iren",
    companyName: "IREN",
    ticker: "IREN",
    pages: ["https://iren.com/investors/news", "https://iren.com/investors/reports"],
    allowedHosts: ["iren.com", "www.iren.com", "iren.gcs-web.com"],
    includePathFragments: ["/static-files/", "/investors/news/", "/investors/reports/"],
  },
];
