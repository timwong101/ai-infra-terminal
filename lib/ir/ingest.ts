import { irSources, type IrSourceConfig } from "@/data/ir-sources";
import { fetchIrPage } from "@/lib/ir/client";
import { deduplicateIrDocuments, normalizeIrPage } from "@/lib/ir/normalize";
import type { IrEvidenceCache } from "@/lib/ir/types";

type RefreshIrOptions = {
  previousCache: IrEvidenceCache | null;
  now?: Date;
  fetchPage?: (config: IrSourceConfig, pageUrl: string) => Promise<string>;
};

export async function refreshIrEvidence({ previousCache, now = new Date(), fetchPage = fetchIrPage }: RefreshIrOptions): Promise<IrEvidenceCache> {
  const fetchedAt = now.toISOString();
  const documents = [];
  const errors: IrEvidenceCache["errors"] = [];
  let successfulPages = 0;

  for (const config of irSources) {
    for (const pageUrl of config.pages) {
      try {
        const html = await fetchPage(config, pageUrl);
        documents.push(...normalizeIrPage(config, pageUrl, html, fetchedAt));
        successfulPages += 1;
      } catch (error) {
        errors.push({ companyId: config.companyId, pageUrl, message: error instanceof Error ? error.message : "Unknown IR ingestion error" });
      }
    }
  }

  if (successfulPages === 0) {
    if (previousCache) return { ...previousCache, errors };
    throw new Error("Every investor-relations request failed.");
  }

  const fresh = deduplicateIrDocuments(documents).slice(0, 80);
  const failedCompanies = new Set(errors.map((error) => error.companyId));
  const fallback = previousCache?.documents.filter((document) => failedCompanies.has(document.companyId)) ?? [];
  return {
    schemaVersion: 1,
    generatedAt: fetchedAt,
    source: "Official company investor-relations pages",
    companies: irSources.map((source) => source.companyId),
    errors,
    documents: deduplicateIrDocuments([...fresh, ...fallback]).slice(0, 80),
  };
}
