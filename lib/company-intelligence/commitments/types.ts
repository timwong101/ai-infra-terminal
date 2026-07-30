export type CommitmentReviewStatus = "proposed" | "accepted" | "rejected";
export type CommitmentRevisionKind = "initiated" | "reiterated" | "raised" | "lowered" | "delayed" | "updated";
export type CommitmentOutcomeStatus = "achieved" | "partial" | "missed" | "not-comparable";

export type CommitmentCandidate = {
  metricKey: string;
  label: string;
  category: string;
  scopeType: string;
  scopeLabel: string;
  statement: string;
  targetValue: number;
  targetDisplay: string;
  targetUnit: string;
  targetPeriodEnd: string | null;
  targetDatePrecision: "day" | "quarter" | "year" | "undated";
  confidence: number;
};

export type CommitmentSource = {
  evidenceId: string;
  sourceType: string;
  documentTitle: string;
  documentDate: string;
  sourceUrl: string;
  pageNumber: number | null;
};

export type CommitmentRevisionItem = {
  id: string;
  sequence: number;
  revisionKind: CommitmentRevisionKind;
  statement: string;
  targetValue: number;
  targetDisplay: string;
  targetUnit: string;
  targetPeriodEnd: string | null;
  targetDatePrecision: string;
  confidence: number;
  validFrom: string;
  recordedAt: string;
  reviewStatus: CommitmentReviewStatus;
  reviewNote: string | null;
  reviewerName: string | null;
  source: CommitmentSource;
};

export type CommitmentOutcomeItem = {
  id: string;
  outcomeStatus: CommitmentOutcomeStatus;
  actualDisplay: string | null;
  actualUnit: string | null;
  actualPeriodEnd: string | null;
  variancePercent: number | null;
  rationale: string;
  confidence: number;
  reviewerName: string;
  recordedAt: string;
};

export type SuggestedCommitmentActual = {
  metricId: string;
  displayValue: string;
  normalizedValue: number;
  unit: string;
  periodEnd: string;
  sourceLabel: string | null;
};

export type CommitmentItem = {
  id: string;
  companyId: string;
  commitmentKey: string;
  metricKey: string;
  label: string;
  category: string;
  scopeType: string;
  scopeLabel: string;
  initialStatement: string;
  reviewStatus: CommitmentReviewStatus;
  reviewNote: string | null;
  reviewerName: string | null;
  createdAt: string;
  currentRevision: CommitmentRevisionItem;
  revisions: CommitmentRevisionItem[];
  outcomes: CommitmentOutcomeItem[];
  suggestedActual: SuggestedCommitmentActual | null;
};

export type CommitmentLedgerResponse = {
  company: { id: string; name: string; ticker: string };
  summary: { total: number; proposed: number; accepted: number; changed: number; reconciled: number; due: number };
  commitments: CommitmentItem[];
  systemTime: string;
};
