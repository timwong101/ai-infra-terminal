import type { ComparisonMemoSection, MemoVerification, ResearchEvidenceItem } from "@/lib/research/types";

export type PublishedReportCompany = {
  id: string;
  name: string;
  ticker: string;
};

export type PublishedReportCompliance = {
  mode: "compliance" | "standard";
  sourceMemoStale: boolean;
  verificationPassed: boolean;
  totalClaims: number;
  publishedClaims: number;
  withheldClaims: number;
  note: string;
};

export type PublishedReportGeneration = {
  engine: string;
  model: string;
  retrievalMode: string;
  verification: MemoVerification | null;
};

export type PublishedReport = {
  id: string;
  memoId: string;
  publicToken: string;
  path: string;
  version: number;
  title: string;
  question: string;
  topic: string;
  asOfDate: string;
  companyA: PublishedReportCompany;
  companyB: PublishedReportCompany;
  confidenceScore: number;
  evidenceQualityScore: number;
  sourceDiversityScore: number;
  sections: ComparisonMemoSection[];
  citations: ResearchEvidenceItem[];
  generation: PublishedReportGeneration | null;
  complianceMode: boolean;
  compliance: PublishedReportCompliance;
  publisher: {
    name: string;
    workspaceName: string;
  };
  revokedAt: string | null;
  publishedAt: string;
};

export type PublishedReportSummary = Pick<
  PublishedReport,
  "id" | "memoId" | "publicToken" | "path" | "version" | "title" | "asOfDate" | "complianceMode" | "compliance" | "revokedAt" | "publishedAt"
>;
