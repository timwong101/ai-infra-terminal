import type { ResearchEvidenceItem } from "@/lib/research/types";

export type ReplayMode = "system-known" | "publication-time";

export type ReplayClaim = {
  id: string;
  companyId: string;
  companyName: string;
  text: string;
  topic: string;
  citationIds: string[];
};

export type ResearchReplayRun = {
  id: string;
  asOfDate: string;
  mode: ReplayMode;
  companyIds: string[];
  topic: string;
  question: string;
  status: "completed" | "error";
  summary: string;
  historicalClaims: ReplayClaim[];
  currentClaims: ReplayClaim[];
  historicalEvidence: ResearchEvidenceItem[];
  currentEvidence: ResearchEvidenceItem[];
  addedEvidence: ResearchEvidenceItem[];
  metrics: {
    historicalEvidence: number;
    currentEvidence: number;
    addedEvidence: number;
    historicalCompanyCoverage: number;
    currentCompanyCoverage: number;
    leakageViolations: number;
    confidence: number;
  };
  createdAt: string;
};

export type ResearchReplayCatalog = {
  companies: Array<{ id: string; name: string; ticker: string }>;
  topics: string[];
  runs: ResearchReplayRun[];
};

