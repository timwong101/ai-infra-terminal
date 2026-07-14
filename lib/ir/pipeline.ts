import { irSources } from "@/data/ir-sources";
import {
  claimNextIrSourceDocument,
  getIrIngestionSummary,
  markIrSourceDocumentFailed,
  persistIrDocumentDetail,
  syncIrSourceCatalog,
} from "@/lib/db/ir-evidence-repository";
import { fetchIrDocumentContent } from "@/lib/ir/client";
import { extractIrHtmlDetail, extractIrPdfDetail } from "@/lib/ir/extract";
import type { IrEvidenceCache, IrIngestionRun, IrIngestionSummary } from "@/lib/ir/types";

const EMPTY_SUMMARY: IrIngestionSummary = { pending: 0, processing: 0, completed: 0, failed: 0 };

export async function syncIrCatalog(cache: IrEvidenceCache) {
  return await syncIrSourceCatalog(cache);
}

export async function processIrExtractionQueue(limit = 1): Promise<IrIngestionRun> {
  const boundedLimit = Math.max(1, Math.min(limit, 25));
  let processed = 0;
  let completed = 0;
  let failed = 0;

  for (let index = 0; index < boundedLimit; index += 1) {
    const document = await claimNextIrSourceDocument();
    if (!document) break;
    processed += 1;
    try {
      const config = irSources.find((source) => source.companyId === document.companyId);
      if (!config) throw new Error("IR source configuration is missing.");
      const content = await fetchIrDocumentContent(config, document);
      const detail = content.kind === "pdf"
        ? await extractIrPdfDetail(content.bytes, document)
        : extractIrHtmlDetail(content.html, document);
      const persisted = await persistIrDocumentDetail(detail);
      if (!persisted) throw new Error("Postgres is unavailable for durable IR extraction.");
      completed += 1;
    } catch (error) {
      failed += 1;
      await markIrSourceDocumentFailed(document.id, error instanceof Error ? error.message : "Unknown IR extraction failure");
    }
  }

  return {
    processed,
    completed,
    failed,
    summary: await getIrIngestionSummary() ?? EMPTY_SUMMARY,
  };
}
