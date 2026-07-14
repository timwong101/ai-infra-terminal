import type { EvidenceSignal } from "@/lib/evidence/types";

export type IrDocumentType = "Earnings Release" | "Presentation" | "Shareholder Letter" | "Press Release";

export type IrDocument = {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  documentType: IrDocumentType;
  publishedAt: string;
  title: string;
  summary: string;
  sourceUrl: string;
  sourcePageUrl: string;
  fetchedAt: string;
  sourceQuality: number;
  relevanceScore: number;
  signal: EvidenceSignal;
};

export type IrEvidenceCache = {
  schemaVersion: 1;
  generatedAt: string;
  source: "Official company investor-relations pages";
  companies: string[];
  errors: Array<{ companyId: string; pageUrl: string; message: string }>;
  documents: IrDocument[];
};

export type IrEvidenceResponse = {
  cache: IrEvidenceCache;
  refresh: { status: "fresh" | "cached" | "stale"; message?: string };
  ingestion?: IrIngestionSummary;
};

export type IrExtractionStatus = "pending" | "processing" | "completed" | "failed";

export type IrIngestionSummary = {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
};

export type IrIngestionRun = {
  processed: number;
  completed: number;
  failed: number;
  summary: IrIngestionSummary;
};

export type IrDocumentDetail = {
  documentId: string;
  companyId: string;
  companyName: string;
  ticker: string;
  documentType: IrDocumentType;
  publishedAt: string;
  title: string;
  sourceUrl: string;
  sourcePageUrl: string;
  retrievedAt: string;
  wordCount: number;
  pageCount: number | null;
  sections: import("@/lib/evidence/types").FilingEvidenceSection[];
  extraction: {
    method: "pdf-text" | "deterministic-html";
    quality: "high" | "medium" | "limited";
    message: string;
  };
};

export type IrDocumentDetailResponse = {
  detail: IrDocumentDetail;
  cacheStatus: "fresh" | "cached";
  persistence: "postgres" | "memory";
};
