export type ResearchBriefingStats = {
  newDocuments: number;
  newEvidence: number;
  highValueEvidence: number;
  pendingReview: number;
  proposedThesisImpacts: number;
  staleMemos: number;
  staleClaims: number;
  ingestionFailures: number;
};

export type ResearchBriefingEvidence = {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  documentTitle: string;
  documentDate: string;
  sourceType: string;
  topic: string;
  excerpt: string;
  sourceUrl: string;
  evidenceQualityScore: number;
  relevanceScore: number;
  duplicateGroupId: string | null;
  reviewStatus: string;
  suggestionStatus: string;
  suggestedImpact: string | null;
};

export type ResearchBriefingSection = {
  companyId: string;
  companyName: string;
  ticker: string;
  newEvidence: number;
  highValueEvidence: number;
  pendingReview: number;
  topEvidence: ResearchBriefingEvidence[];
};

export type ResearchBriefing = {
  id: string;
  runId: string | null;
  title: string;
  summary: string;
  status: string;
  windowStartedAt: string;
  windowEndedAt: string;
  stats: ResearchBriefingStats;
  sections: ResearchBriefingSection[];
  createdAt: string;
};

export type ResearchCycleEventItem = {
  id: string;
  runId: string;
  stage: string;
  status: string;
  attempt: number;
  message: string | null;
  metrics: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
};
