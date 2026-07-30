export type EvidenceReviewStatus = "unreviewed" | "accepted" | "rejected";
export type EvidenceSuggestionStatus = "pending" | "accepted" | "rejected";
export type ResearchSourceKind = "sec" | "ir";

export type ResearchAssistantFilters = {
  companyIds: string[];
  topic: string;
  sourceKinds: ResearchSourceKind[];
  dateFrom?: string;
  dateTo?: string;
};

export type ResearchAssistantClaim = {
  companyId: string;
  text: string;
  citationIds: string[];
  confidenceScore: number;
};

export type ResearchMetricSnapshot = {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  periodLabel: string;
  periodEnd: string;
  metricKey: string;
  label: string;
  displayValue: string;
  normalizedValue: number;
  unit: string;
  sourceKind: string;
  sourceLabel: string;
  sourceUrl: string | null;
  documentDate: string;
};

export type ResearchAssistantMessage = {
  id: string;
  question: string;
  answerMarkdown: string | null;
  claims: ResearchAssistantClaim[];
  openQuestions: Array<{ companyId: string; text: string }>;
  confidenceScore: number | null;
  evidenceQualityScore: number | null;
  sourceDiversityScore: number | null;
  engine: string;
  model: string;
  promptVersion: string;
  configSnapshot: Record<string, unknown>;
  retrievalMode: string;
  status: "running" | "completed" | "error";
  filters: ResearchAssistantFilters;
  citations: ResearchEvidenceItem[];
  metricSnapshot: ResearchMetricSnapshot[];
  verification: { passed: boolean; rejectedClaims: number; checkedClaims: number; allowedCitations: number } | null;
  estimatedCostMicros: number;
  latencyMs: number | null;
  error: string | null;
  createdAt: string;
};

export type ResearchAssistantSession = {
  id: string;
  title: string;
  filters: ResearchAssistantFilters;
  messages: ResearchAssistantMessage[];
  createdAt: string;
  updatedAt: string;
};

export type ResearchQualityScores = {
  retrievalCoverage: number;
  citationPrecision: number;
  groundedness: number;
  companyAccuracy: number;
  answerCompleteness: number;
  overall: number;
};

export type ResearchQualityResult = {
  id: string;
  benchmarkId: string;
  caseOrigin: "curated" | "production";
  caseVersion: number;
  title: string;
  category: string;
  question: string;
  companyIds: string[];
  expectations: { topics: string[]; behavior: "answer" | "insufficient"; minimumCitations: number };
  status: "passed" | "failed";
  scores: ResearchQualityScores;
  failureReasons: string[];
  citations: ResearchEvidenceItem[];
  claims: ResearchAssistantClaim[];
  retrievalMode: string;
  citationCount: number;
  unsupportedClaimCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostMicros: number;
  latencyMs: number;
};

export type ResearchQualityRun = {
  id: string;
  suiteVersion: string;
  engine: string;
  status: "running" | "completed" | "error";
  overallScore: number | null;
  passRate: number | null;
  metrics: Omit<ResearchQualityScores, "overall"> | Record<string, never>;
  caseCount: number;
  passedCount: number;
  failedCount: number;
  durationMs: number | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  results: ResearchQualityResult[];
};

export type ResearchQualityFailureType =
  | "wrong-retrieval"
  | "unsupported-claim"
  | "citation-mismatch"
  | "incorrect-metric"
  | "stale-source"
  | "missing-evidence"
  | "should-abstain"
  | "incorrect-answer";

export type ResearchQualityTrace = {
  sourceType: "research-assistant";
  sourceEntityId: string;
  question: string;
  answerMarkdown: string | null;
  claims: ResearchAssistantClaim[];
  filters: ResearchAssistantFilters;
  engine: string;
  model: string;
  prompt: string | null;
  promptVersion: string;
  configSnapshot: Record<string, unknown>;
  retrievalMode: string;
  evidenceSnapshot: ResearchEvidenceItem[];
  metricSnapshot: ResearchMetricSnapshot[];
  verification: ResearchAssistantMessage["verification"];
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  estimatedCostMicros: number;
  latencyMs: number | null;
  completedAt: string | null;
};

export type ResearchQualityFeedback = {
  id: string;
  sourceType: "research-assistant";
  sourceEntityId: string;
  failureType: ResearchQualityFailureType;
  severity: "low" | "medium" | "high" | "critical";
  summary: string;
  expectedBehavior: string | null;
  status: "open" | "adjudicated" | "promoted" | "dismissed";
  trace: ResearchQualityTrace;
  adjudication: { companyIds?: string[] };
  promotedCaseId: string | null;
  reporter: { id: string; name: string };
  adjudicator: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type ResearchQualityCase = {
  id: string;
  stableKey: string;
  title: string;
  category: string;
  status: "active" | "archived";
  currentVersion: number;
  sourceFeedbackId: string | null;
  question: string;
  filters: ResearchAssistantFilters;
  expectations: {
    topics: string[];
    behavior: "answer" | "insufficient";
    minimumCitations: number;
    expectedEvidenceIds?: string[];
  };
  createdAt: string;
  updatedAt: string;
};

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
  contentHash: string;
  evidenceQualityScore: number;
  materialityScore: number;
  specificityScore: number;
  relevanceScore: number;
  boilerplateRisk: number;
  qualityReasons: string[];
  duplicateGroupId: string | null;
  duplicateCount: number;
  suggestedClaimId: string | null;
  suggestedClaimTitle: string | null;
  suggestedImpact: "supports" | "weakens" | "watch" | null;
  suggestionConfidence: number;
  suggestionRationale: string | null;
  suggestionStatus: EvidenceSuggestionStatus;
  qualityScoredAt: string | null;
  reviewStatus: EvidenceReviewStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy?: { id: string; name: string; email: string } | null;
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
  claims: Array<{ id: string; companyId: string; title: string; kind: string }>;
  qualitySummary: { highValue: number; boilerplateRisk: number; pendingSuggestions: number; duplicatePassages: number };
  synced: { sec: number; ir: number; baselineAccepted?: number };
};

export type MemoClaim = {
  companyId: string;
  text: string;
  citationIds: string[];
  representation?: "quote" | "paraphrase" | "question";
  synthesisStatus?: "verified" | "source-fallback" | "not-applicable";
  whyItMatters?: string;
  qualityScore?: number;
};

export type MemoVerification = {
  passed: boolean;
  rejectedClaims: number;
  checkedClaims: number;
  allowedCitations: number;
  synthesisFallbackClaims?: number;
  duplicateClaims?: number;
  numericFidelityFailures?: number;
  quoteFidelityFailures?: number;
  semanticSupportFailures?: number;
  malformedClaims?: number;
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
  status: "draft" | "in_review" | "changes_requested" | "approved" | "published";
  isStale: boolean;
  staleReason: string | null;
  staleAt: string | null;
  sections: ComparisonMemoSection[];
  citations: ResearchEvidenceItem[];
  metricSnapshot?: ResearchMetricSnapshot[];
  generation?: {
    engine: string;
    retrievalMode: string;
    verification: MemoVerification;
  };
  createdAt: string;
  updatedAt: string;
};
