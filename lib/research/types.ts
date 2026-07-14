export type EvidenceReviewStatus = "unreviewed" | "accepted" | "rejected";
export type ResearchSourceKind = "sec" | "ir";

export type ResearchEvidenceItem = {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  sourceKind: ResearchSourceKind;
  sourceDocumentId: string;
  sourcePassageId: string;
  sourceType: string;
  documentTitle: string;
  documentDate: string;
  sectionTitle: string;
  topic: string;
  excerpt: string;
  sourceUrl: string;
  pageNumber: number | null;
  sourceQuality: number;
  reviewStatus: EvidenceReviewStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
};

export type EvidenceFilters = {
  query?: string;
  companyId?: string;
  topic?: string;
  sourceKind?: ResearchSourceKind;
  reviewStatus?: EvidenceReviewStatus;
  dateFrom?: string;
};

export type EvidenceWorkspaceResponse = {
  items: ResearchEvidenceItem[];
  total: number;
  summary: Record<EvidenceReviewStatus, number>;
  companies: Array<{ id: string; name: string; ticker: string; evidenceCount: number }>;
  topics: Array<{ name: string; evidenceCount: number }>;
  synced: { sec: number; ir: number };
};

export type MemoClaim = {
  companyId: string;
  text: string;
  citationIds: string[];
};

export type ComparisonMemoSection = {
  key: "summary" | "exposure" | "advantages" | "risks" | "catalysts" | "questions";
  title: string;
  claims: MemoClaim[];
};

export type ComparisonMemo = {
  id: string;
  title: string;
  question: string;
  companyA: { id: string; name: string; ticker: string };
  companyB: { id: string; name: string; ticker: string };
  topic: string;
  confidenceScore: number;
  evidenceQualityScore: number;
  sourceDiversityScore: number;
  status: "draft" | "final";
  sections: ComparisonMemoSection[];
  citations: ResearchEvidenceItem[];
  generation?: {
    engine: string;
    retrievalMode: string;
    verification: { passed: boolean; rejectedClaims: number; checkedClaims: number; allowedCitations: number };
  };
  createdAt: string;
  updatedAt: string;
};
