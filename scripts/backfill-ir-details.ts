import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { irSources } from "@/data/ir-sources";
import { getPersistedIrDocumentDetail, persistIrDocumentDetail } from "@/lib/db/ir-evidence-repository";
import { fetchIrDocumentContent } from "@/lib/ir/client";
import { buildCatalogOnlyIrDetail, extractIrHtmlDetail, extractIrPdfDetail } from "@/lib/ir/extract";
import { syncIrCatalog } from "@/lib/ir/pipeline";
import type { IrEvidenceCache } from "@/lib/ir/types";

const CACHE_PATH = resolve("data/generated/ir-evidence.json");

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required to backfill IR document evidence.");
  const cache = JSON.parse(await readFile(CACHE_PATH, "utf8")) as IrEvidenceCache;
  await syncIrCatalog(cache);
  const force = process.argv.includes("--force");
  const companyId = process.argv.find((argument) => argument.startsWith("--company="))?.slice("--company=".length);
  const documents = companyId ? cache.documents.filter((document) => document.companyId === companyId) : cache.documents;
  let persisted = 0;
  let reused = 0;
  let failed = 0;

  for (const [index, document] of documents.entries()) {
    try {
      const existing = force ? null : await getPersistedIrDocumentDetail(document.id);
      if (existing) {
        reused += 1;
        console.log(`[${index + 1}/${documents.length}] cached: ${document.title}`);
        continue;
      }
      const config = irSources.find((source) => source.companyId === document.companyId);
      if (!config) throw new Error("IR source configuration is missing.");
      const isCatalogOnly = config.catalogOnlyHosts?.includes(new URL(document.sourceUrl).hostname) ?? false;
      const detail = isCatalogOnly
        ? buildCatalogOnlyIrDetail(document)
        : await fetchIrDocumentContent(config, document).then((content) => content.kind === "pdf"
          ? extractIrPdfDetail(content.bytes, document)
          : extractIrHtmlDetail(content.html, document));
      await persistIrDocumentDetail(detail);
      persisted += 1;
      console.log(`[${index + 1}/${documents.length}] persisted: ${document.title} (${detail.sections.length} topics)`);
    } catch (error) {
      failed += 1;
      console.error(`[${index + 1}/${documents.length}] failed: ${document.title}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`IR backfill complete: ${persisted} persisted, ${reused} reused, ${failed} failed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
