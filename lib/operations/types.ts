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
  workspaceId: string;
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
  jobId: string | null;
  maxAttempts: number;
  message: string | null;
  metrics: Record<string, unknown>;
  nextRetryAt: string | null;
  startedAt: string;
  completedAt: string | null;
};

export const RESEARCH_STAGE_NAMES = [
  "ingesting-sec",
  "ingesting-ir",
  "refreshing-events",
  "verifying-artifacts",
  "syncing-evidence",
  "updating-company-intelligence",
  "embedding-evidence",
  "updating-theses",
  "building-briefing",
] as const;

export type ResearchStageName = typeof RESEARCH_STAGE_NAMES[number];

export type ResearchCycleJobData = {
  runId: string;
  trigger: string;
  traceId: string;
  windowStartedAt: string;
};

export type ResearchStageJobData = ResearchCycleJobData & {
  stage: ResearchStageName;
};

export type ResearchCycleRunItem = {
  id: string;
  trigger: string;
  status: string;
  stage: string;
  queueJobId: string | null;
  traceId: string | null;
  workerId: string | null;
  retryOfRunId: string | null;
  progress: number;
  metrics: Record<string, unknown>;
  error: string | null;
  cancelRequestedAt: string | null;
  lastHeartbeatAt: string | null;
  startedAt: string;
  completedAt: string | null;
  createdAt: string;
};

export type ResearchWorkerItem = {
  id: string;
  queueName: string;
  status: string;
  currentRunId: string | null;
  concurrency: number;
  metadata: Record<string, unknown>;
  startedAt: string;
  lastHeartbeatAt: string;
  online: boolean;
};

export type ResearchQueueStatus = {
  available: boolean;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  deadLetters: number;
  error: string | null;
};

export type ResearchRuntimeSnapshot = {
  runs: ResearchCycleRunItem[];
  events: ResearchCycleEventItem[];
  workers: ResearchWorkerItem[];
  queue: ResearchQueueStatus;
  generatedAt: string;
};
