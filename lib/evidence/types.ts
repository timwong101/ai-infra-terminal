export type EvidenceSignal = "positive" | "neutral" | "watch" | "negative";

export type EvidenceEvent = {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  cik: string;
  theme: "Neoclouds";
  sourceType: "SEC";
  formType: string;
  filedAt: string;
  acceptedAt: string;
  periodOfReport: string | null;
  headline: string;
  summary: string;
  accessionNumber: string;
  primaryDocument: string;
  sourceUrl: string;
  fetchedAt: string;
  sourceQuality: number;
  signal: EvidenceSignal;
  issuerClassification: "domestic" | "foreign-private";
};

export type EvidenceCache = {
  schemaVersion: 1;
  generatedAt: string;
  source: "SEC EDGAR submissions API";
  lookbackDays: number;
  companies: string[];
  errors: Array<{ companyId: string; message: string }>;
  warnings: Array<{ companyId: string; formType: string; filedAt: string; message: string }>;
  filings: EvidenceEvent[];
};

export type SecRefreshStatus = "fresh" | "cached" | "stale";

export type SecEvidenceResponse = {
  cache: EvidenceCache;
  refresh: {
    status: SecRefreshStatus;
    message?: string;
  };
};

export type EvidencePassage = {
  id: string;
  text: string;
  wordCount: number;
  pageNumber?: number;
};

export type FilingEvidenceSection = {
  id: string;
  title: string;
  category: string;
  itemCode?: string;
  pageStart?: number;
  pageEnd?: number;
  passages: EvidencePassage[];
};

export type SecFilingDetail = {
  filingId: string;
  companyId: string;
  companyName: string;
  ticker: string;
  formType: string;
  filedAt: string;
  accessionNumber: string;
  documentTitle: string;
  sourceUrl: string;
  retrievedAt: string;
  wordCount: number;
  sections: FilingEvidenceSection[];
  extraction: {
    method: "deterministic-html";
    quality: "high" | "medium" | "limited";
    message: string;
  };
};

export type SecFilingDetailResponse = {
  detail: SecFilingDetail;
  cacheStatus: "fresh" | "cached";
  persistence: "postgres" | "memory";
  comparison: FilingComparison | null;
};

export type FilingComparisonMode = "event" | "periodic" | "amendment";
export type FilingChangeType = "new_event" | "added" | "modified" | "not_repeated" | "explicitly_removed";
export type FilingChangeSignificance = "high" | "medium" | "low";

export type FilingChange = {
  id: string;
  type: FilingChangeType;
  significance: FilingChangeSignificance;
  category: string;
  sectionTitle: string;
  summary: string;
  similarity: number | null;
  currentText: string | null;
  previousText: string | null;
  eventType: string | null;
  eventCode: string | null;
  relevanceScore: number | null;
  relevanceReason: string | null;
};

export type FilingComparison = {
  mode: FilingComparisonMode;
  policyLabel: string;
  currentFilingId: string;
  previousFiling: {
    filingId: string;
    formType: string;
    filedAt: string;
    sourceUrl: string;
  } | null;
  counts: Record<FilingChangeType, number>;
  changes: FilingChange[];
};
