import type { ResearchEvidenceItem } from "@/lib/research/types";

export type ExtractedMetric = {
  metricKey: string;
  label: string;
  category: string;
  normalizedValue: number;
  displayValue: string;
  unit: string;
  context: string;
  confidence: number;
};

export type IntelligencePeriod = {
  id: string;
  periodKey: string;
  label: string;
  periodStart: string;
  periodEnd: string;
  latestDocumentDate: string;
  evidenceCount: number;
  periodKind: "quarter" | "annual" | "calendar-fallback";
  periodBasis: "reported" | "inferred" | "calendar-fallback";
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  resolutionMethod: string;
  resolutionConfidence: number;
};

export type EarningsPackageDocument = {
  id: string;
  sourceKind: string;
  sourceDocumentId: string;
  sourceType: string;
  documentTitle: string;
  sourceUrl: string;
  publicationDate: string;
  periodOfReport: string | null;
  resolutionMethod: string;
  resolutionConfidence: number;
  extractionStatus: string | null;
  evidenceCount: number;
};

export type IntelligenceComparison = {
  id: string;
  comparisonKind: "metric" | "disclosure";
  category: string;
  label: string;
  direction: "increased" | "decreased" | "unchanged" | "new" | "changed" | "removed";
  significance: "high" | "medium" | "low";
  currentValue: string | null;
  previousValue: string | null;
  deltaPercent: number | null;
  summary: string;
  currentText: string | null;
  previousText: string | null;
  evidenceIds: string[];
  tone: "stronger" | "weaker" | "more uncertain" | "neutral";
};

export type CompanyIntelligenceResponse = {
  companies: Array<{ id: string; name: string; ticker: string; periodCount: number; latestPeriod: string | null }>;
  company: { id: string; name: string; ticker: string };
  periods: IntelligencePeriod[];
  currentPeriod: IntelligencePeriod;
  previousPeriod: IntelligencePeriod | null;
  comparisons: IntelligenceComparison[];
  evidence: ResearchEvidenceItem[];
  earningsPackage: { id: string; label: string; documentCount: number; evidenceCount: number; documents: EarningsPackageDocument[] } | null;
  claims: Array<{ id: string; title: string; statement: string; supportScore: number; kind: string }>;
  summary: { metrics: number; disclosures: number; highSignificance: number; evidenceSources: number };
};
