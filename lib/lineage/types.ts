export type LineageNodeKind = "company" | "source" | "evidence" | "claim" | "memo" | "event";

export type LineageNode = {
  id: string;
  kind: LineageNodeKind;
  label: string;
  subtitle: string;
  compliant: boolean;
  status: string;
  score: number | null;
  url: string | null;
  details: Record<string, string | number | boolean | null>;
};

export type LineageEdge = {
  id: string;
  source: string;
  target: string;
  label: string;
  compliant: boolean;
};

export type LineageGraph = {
  nodes: LineageNode[];
  edges: LineageEdge[];
  summary: {
    companies: number;
    sources: number;
    evidence: number;
    claims: number;
    memos: number;
    events: number;
    unsupported: number;
  };
};

