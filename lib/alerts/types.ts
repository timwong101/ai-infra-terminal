export type AlertStatus = "unread" | "reviewed" | "watching" | "dismissed";
export type AlertImpact = "strengthens" | "weakens" | "watch";

export type ResearchAlert = {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  filingId: string | null;
  formType: string;
  filedAt: string;
  sourceUrl: string | null;
  alertType: "filing_change" | "claim_impact";
  category: string;
  significance: "high" | "medium" | "low";
  impact: AlertImpact;
  title: string;
  summary: string;
  sectionTitle: string;
  changeType: "new_event" | "added" | "modified" | "explicitly_removed" | "reviewed_evidence";
  similarity: number | null;
  eventType: string | null;
  eventCode: string | null;
  relevanceScore: number | null;
  relevanceReason: string | null;
  status: AlertStatus;
  createdAt: string;
};

export type ThesisSnapshot = {
  date: string;
  supportScore: number;
  evidenceCount: number;
  supportingCount: number;
  weakeningCount: number;
};

export type ResearchClaim = {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  kind: string;
  title: string;
  statement: string;
  supportScore: number;
  evidenceCount: number;
  supportingCount: number;
  weakeningCount: number;
  snapshots: ThesisSnapshot[];
};

export type AlertsResponse = {
  alerts: ResearchAlert[];
  claims: ResearchClaim[];
  summary: {
    total: number;
    unread: number;
    high: number;
    watching: number;
    reviewed: number;
  };
  filters: {
    companies: Array<{ id: string; name: string; ticker: string }>;
    categories: string[];
  };
};
