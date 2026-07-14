import type { EvidenceCache, SecFilingDetail } from "@/lib/evidence/types";
import { baseFilingForm, compareFilings, getFilingComparisonMode } from "@/lib/evidence/compare";
import {
  getPersistedFilingDetail,
  persistFilingComparison,
  persistFilingDetail,
} from "@/lib/db/evidence-repository";
import { fetchSecDocument } from "@/lib/sec/client";
import { extractSecFilingDetail } from "@/lib/sec/extract";

type SyncProgress = {
  processed: number;
  total: number;
  filingId: string;
  status: "persisted" | "cached" | "failed";
};

type SyncOptions = {
  requestDelayMs?: number;
  force?: boolean;
  onProgress?: (progress: SyncProgress) => void;
};

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function syncSecFilingEvidence(
  cache: EvidenceCache,
  userAgent: string,
  { requestDelayMs = 250, force = false, onProgress }: SyncOptions = {},
) {
  const ordered = [...cache.filings].sort((left, right) => left.filedAt.localeCompare(right.filedAt));
  const previousByCompanyAndForm = new Map<string, SecFilingDetail>();
  let persisted = 0;
  let reused = 0;
  let failed = 0;

  for (const [index, filing] of ordered.entries()) {
    let detail: SecFilingDetail | null = null;
    let status: SyncProgress["status"] = "cached";

    try {
      detail = force ? null : await getPersistedFilingDetail(filing.id);
      if (detail) {
        reused += 1;
      } else {
        const html = await fetchSecDocument(filing.sourceUrl, userAgent);
        detail = extractSecFilingDetail(html, {
          filingId: filing.id,
          companyId: filing.companyId,
          companyName: filing.companyName,
          ticker: filing.ticker,
          formType: filing.formType,
          filedAt: filing.filedAt,
          accessionNumber: filing.accessionNumber,
          sourceUrl: filing.sourceUrl,
        });
        await persistFilingDetail(detail);
        persisted += 1;
        status = "persisted";
      }

      const mode = getFilingComparisonMode(filing.formType);
      const comparisonKey = `${filing.companyId}:${baseFilingForm(filing.formType)}`;
      const previous = mode === "event" ? null : previousByCompanyAndForm.get(comparisonKey) ?? null;
      const comparison = compareFilings(detail, previous);
      if (comparison) await persistFilingComparison(comparison);
      if (mode === "periodic") previousByCompanyAndForm.set(comparisonKey, detail);
    } catch {
      failed += 1;
      status = "failed";
    }

    onProgress?.({ processed: index + 1, total: ordered.length, filingId: filing.id, status });
    if (requestDelayMs > 0 && index < ordered.length - 1 && status === "persisted") {
      await wait(requestDelayMs);
    }
  }

  return { total: ordered.length, persisted, reused, failed };
}
