import { irSources } from "@/data/ir-sources";
import {
  claimNextIrSourceDocument,
  getIrIngestionSummary,
  markIrSourceDocumentFailed,
  persistIrDocumentDetail,
  syncIrSourceCatalog,
} from "@/lib/db/ir-evidence-repository";
import { fetchIrDocumentContent } from "@/lib/ir/client";
import { buildCatalogOnlyIrDetail, extractIrHtmlDetail, extractIrPdfDetail } from "@/lib/ir/extract";
import { archiveSourceBytes, recordInitialExtraction } from "@/lib/artifacts/service";
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
  const companyOrder = irSources.map((source) => source.companyId);

  for (let index = 0; index < boundedLimit; index += 1) {
    const document = await claimNextIrSourceDocument(companyOrder[index % companyOrder.length])
      ?? await claimNextIrSourceDocument();
    if (!document) break;
    processed += 1;
    try {
      const extractionStartedAt = Date.now();
      const config = irSources.find((source) => source.companyId === document.companyId);
      if (!config) throw new Error("IR source configuration is missing.");
      const isCatalogOnly = config.catalogOnlyHosts?.includes(new URL(document.sourceUrl).hostname) ?? false;
      const content = isCatalogOnly
        ? { kind: "catalog" as const, bytes: new TextEncoder().encode(JSON.stringify(document)) }
        : await fetchIrDocumentContent(config, document).then((item) => item.kind === "pdf"
          ? { kind: "pdf" as const, bytes: item.bytes }
          : { kind: "html" as const, bytes: new TextEncoder().encode(item.html) });
      const archived = await archiveSourceBytes({
        sourceKind: "ir",
        sourceDocumentId: document.id,
        companyId: document.companyId,
        sourceUrl: document.sourceUrl,
        bytes: content.bytes,
        contentType: content.kind === "pdf" ? "application/pdf" : content.kind === "catalog" ? "application/vnd.ai-infra.catalog+json" : "text/html; charset=utf-8",
        fetchedAt: document.fetchedAt,
      });
      const detail = content.kind === "catalog"
        ? buildCatalogOnlyIrDetail(document, archived.version.fetchedAt.toISOString())
        : content.kind === "pdf"
          ? await extractIrPdfDetail(content.bytes, document, archived.version.fetchedAt.toISOString())
          : extractIrHtmlDetail(new TextDecoder().decode(content.bytes), document, archived.version.fetchedAt.toISOString());
      const persisted = await persistIrDocumentDetail(detail);
      if (!persisted) throw new Error("Postgres is unavailable for durable IR extraction.");
      await recordInitialExtraction(archived, detail, Date.now() - extractionStartedAt);
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
