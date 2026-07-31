import type { ArtifactSourceKind, ExtractionDiffSummary } from "@/lib/artifacts/types";

export type ExpectedMetric = { metricKey: string; value: number; unit: string; tolerancePercent?: number };
export type ForbiddenMetric = { metricKey: string; value?: number; tolerancePercent?: number };

export type ExtractionBenchmarkExpectations = {
  minimumSections: number;
  minimumPassages: number;
  expectedTopics: string[];
  allowedTopics?: string[];
  allowedMetricKeys: string[];
  expectedMetrics: ExpectedMetric[];
  forbiddenMetrics?: ForbiddenMetric[];
  expectedCommitmentKeys?: string[];
  expectedPeriod?: { periodKind: "quarter" | "annual"; fiscalYear: number | null; fiscalQuarter: number | null; periodEnd: string };
};

export type ExtractionBenchmarkCase = {
  id: string;
  suiteVersion: string;
  caseVersion: number;
  title: string;
  companyId: string;
  sourceKind: ArtifactSourceKind;
  sourceDocumentId: string;
  origin: string;
  severity: "critical" | "high" | "medium";
  expectations: ExtractionBenchmarkExpectations;
  active: boolean;
};

export type ExtractionQualityScores = {
  structure: number;
  topicRecall: number;
  topicPrecision: number;
  metricRecall: number;
  metricPrecision: number;
  forbiddenSafety: number;
  periodAccuracy: number;
  commitmentRecall: number;
  overall: number;
};

export type ExtractionQualityActual = {
  sections: number;
  passages: number;
  topics: string[];
  metrics: Array<{ metricKey: string; value: number; unit: string; context: string }>;
  commitmentKeys: string[];
  period: { label: string; periodKind: string; fiscalYear: number | null; fiscalQuarter: number | null; periodEnd: string } | null;
  parserVersion: string;
  diff: ExtractionDiffSummary;
};

export type ExtractionQualityResult = {
  id: string;
  benchmarkId: string;
  companyId: string;
  sourceKind: ArtifactSourceKind;
  sourceDocumentId: string;
  title: string;
  status: "passed" | "failed";
  artifactHash: string | null;
  extractionRunId: string | null;
  scores: ExtractionQualityScores;
  expected: ExtractionBenchmarkExpectations;
  actual: ExtractionQualityActual | { error: string };
  failureReasons: string[];
  durationMs: number;
};

export type ExtractionQualityRun = {
  id: string;
  suiteVersion: string;
  parserVersion: string;
  status: "running" | "completed" | "error";
  overallScore: number | null;
  passRate: number | null;
  metrics: Omit<ExtractionQualityScores, "overall">;
  caseCount: number;
  passedCount: number;
  failedCount: number;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  results: ExtractionQualityResult[];
};

export type ParserRelease = {
  id: string;
  parserVersion: string;
  benchmarkRunId: string;
  status: string;
  qualityScore: number;
  releaseNotes: string;
  promotedAt: string | null;
};
