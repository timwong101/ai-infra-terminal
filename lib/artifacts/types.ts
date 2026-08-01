import type { IrDocumentDetail } from "@/lib/ir/types";
import type { SecFilingDetail } from "@/lib/evidence/types";

export type ArtifactSourceKind = "sec" | "ir";
export type ExtractionSnapshot = SecFilingDetail | IrDocumentDetail;

export type ExtractionDiffSummary = {
  beforeSections: number;
  afterSections: number;
  beforePassages: number;
  afterPassages: number;
  addedPassages: number;
  removedPassages: number;
  changedPassages: number;
  unchangedPassages: number;
  wordCountDelta: number;
};
export type SourceArtifactProvenance = {
  sourceKind: ArtifactSourceKind;
  sourceDocumentId: string;
  archived: boolean;
  storageConfigured: boolean;
  artifact: null | {
    id: string;
    contentHash: string;
    storageBackend: string;
    storageStatus: string;
    contentType: string;
    byteLength: number;
    sourceUrl: string;
    fetchedAt: string;
    etag: string | null;
    lastModified: string | null;
    verifiedAt: string | null;
  };
  currentExtraction: SourceExtractionRunItem | null;
  previews: SourceExtractionRunItem[];
};

export type SourceExtractionRunItem = {
  id: string;
  runKind: string;
  parserName: string;
  parserVersion: string;
  codeVersion: string;
  status: string;
  inputHash: string;
  outputHash: string;
  passageCount: number;
  sectionCount: number;
  diffSummary: ExtractionDiffSummary;
  durationMs: number;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  promotedAt: string | null;
};

export type ArtifactIntegritySummary = {
  storageConfigured: boolean;
  storageBackend: string;
  sourceDocuments: number;
  archivedDocuments: number;
  immutableArtifacts: number;
  archivedBytes: number;
  coveragePercent: number;
  verifiedArtifacts: number;
  corruptArtifacts: number;
  previewRuns: number;
  failedRuns: number;
  latestArchivedAt: string | null;
  latestVerifiedAt: string | null;
};
