export type LiveEventSourceKind = "official-ir" | "gdelt";
export type LiveEventEvidenceStatus = "official" | "discovery";

export type LiveEventItem = {
  id: string;
  companyId: string;
  companyName: string;
  ticker: string;
  theme: string;
  sourceKind: LiveEventSourceKind;
  sourceName: string;
  sourceDomain: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: string;
  eventType: string;
  materialityScore: number;
  credibilityScore: number;
  evidenceStatus: LiveEventEvidenceStatus;
  language: string | null;
  sourceCountry: string | null;
  claimImpact: {
    claimId: string;
    claimTitle: string;
    impact: "supports" | "weakens" | "watch";
    rationale: string;
    status: "proposed" | "accepted" | "rejected";
  } | null;
};

export type LiveEventCatalog = {
  events: LiveEventItem[];
  companies: Array<{ id: string; name: string; ticker: string; count: number }>;
  summary: { total: number; official: number; discovery: number; highMateriality: number; lastPublishedAt: string | null };
  refresh: { lastSeenAt: string | null; sources: Array<{ kind: LiveEventSourceKind; count: number }> };
};

