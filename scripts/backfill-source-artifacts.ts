import { eq } from "drizzle-orm";
import { irSources } from "@/data/ir-sources";
import { archiveSourceBytes, recordBackfilledExtraction } from "@/lib/artifacts/service";
import { sourceDocumentVersions } from "@/lib/artifacts/schema";
import { getPersistedFilingDetail } from "@/lib/db/evidence-repository";
import { getPersistedIrDocumentDetail } from "@/lib/db/ir-evidence-repository";
import { withDatabase } from "@/lib/db/client";
import { companies, filings, irDocuments } from "@/lib/db/schema";
import { fetchSecDocument, validateSecUserAgent } from "@/lib/sec/client";
import { extractSecFilingDetail } from "@/lib/sec/extract";
import { fetchIrDocumentContent } from "@/lib/ir/client";
import { buildCatalogOnlyIrDetail, extractIrHtmlDetail, extractIrPdfDetail } from "@/lib/ir/extract";
import type { IrDocument } from "@/lib/ir/types";

const limitArgument = process.argv.find((item) => item.startsWith("--limit="));
const limit = Math.max(1, Math.min(500, Number(limitArgument?.split("=")[1] ?? 500)));
const userAgent = validateSecUserAgent(process.env.SEC_USER_AGENT);

function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function main() {
  const inventory = await withDatabase(async (db) => {
    const versions = await db.select().from(sourceDocumentVersions);
    const archived = new Set(versions.map((item) => `${item.sourceKind}:${item.sourceDocumentId}`));
    const sec = (await db.select({ filing: filings, company: companies }).from(filings).innerJoin(companies, eq(filings.companyId, companies.id)))
      .filter((item) => !archived.has(`sec:${item.filing.id}`));
    const ir = (await db.select({ document: irDocuments, company: companies }).from(irDocuments).innerJoin(companies, eq(irDocuments.companyId, companies.id)))
      .filter((item) => !archived.has(`ir:${item.document.id}`));
    return { sec, ir };
  });
  if (!inventory) throw new Error("Postgres is required to backfill source artifacts.");

  const queue = [
    ...inventory.sec.map((item) => ({ kind: "sec" as const, item })),
    ...inventory.ir.map((item) => ({ kind: "ir" as const, item })),
  ].slice(0, limit);
  let archived = 0;
  let previews = 0;
  let failed = 0;

  for (const [index, entry] of queue.entries()) {
    try {
      const startedAt = Date.now();
      if (entry.kind === "sec") {
        const current = await getPersistedFilingDetail(entry.item.filing.id);
        if (!current) throw new Error("Canonical SEC extraction is missing.");
        const html = await fetchSecDocument(entry.item.filing.sourceUrl, userAgent);
        const source = await archiveSourceBytes({
          sourceKind: "sec",
          sourceDocumentId: entry.item.filing.id,
          companyId: entry.item.company.id,
          sourceUrl: entry.item.filing.sourceUrl,
          bytes: new TextEncoder().encode(html),
          contentType: "text/html; charset=utf-8",
        });
        const extracted = extractSecFilingDetail(html, {
          filingId: current.filingId,
          companyId: current.companyId,
          companyName: current.companyName,
          ticker: current.ticker,
          formType: current.formType,
          filedAt: current.filedAt,
          periodOfReport: current.periodOfReport,
          accessionNumber: current.accessionNumber,
          sourceUrl: current.sourceUrl,
        }, source.version.fetchedAt.toISOString());
        const run = await recordBackfilledExtraction(source, current, extracted, Date.now() - startedAt);
        if (run.status === "preview") previews += 1;
      } else {
        const current = await getPersistedIrDocumentDetail(entry.item.document.id);
        if (!current) throw new Error("Canonical IR extraction is missing.");
        const config = irSources.find((item) => item.companyId === entry.item.company.id);
        if (!config) throw new Error("IR source configuration is missing.");
        const document: IrDocument = {
          id: entry.item.document.id,
          companyId: entry.item.company.id,
          companyName: entry.item.company.name,
          ticker: entry.item.company.ticker,
          documentType: entry.item.document.documentType as IrDocument["documentType"],
          publishedAt: entry.item.document.publishedAt,
          title: entry.item.document.title,
          summary: entry.item.document.extractionMessage,
          sourceUrl: entry.item.document.sourceUrl,
          sourcePageUrl: entry.item.document.sourcePageUrl,
          fetchedAt: entry.item.document.retrievedAt.toISOString(),
          sourceQuality: 100,
          relevanceScore: 100,
          signal: "neutral",
        };
        const catalogOnly = config.catalogOnlyHosts?.includes(new URL(document.sourceUrl).hostname) ?? false;
        let content: { kind: "catalog" | "pdf" | "html"; bytes: Uint8Array };
        if (catalogOnly) {
          content = { kind: "catalog", bytes: new TextEncoder().encode(JSON.stringify(document)) };
        } else {
          try {
            content = await fetchIrDocumentContent(config, document).then((item) => item.kind === "pdf"
              ? { kind: "pdf" as const, bytes: item.bytes }
              : { kind: "html" as const, bytes: new TextEncoder().encode(item.html) });
          } catch (error) {
            console.warn(`IR raw source unavailable; archiving catalog metadata for ${document.id}: ${error instanceof Error ? error.message : error}`);
            content = { kind: "catalog", bytes: new TextEncoder().encode(JSON.stringify(document)) };
          }
        }
        const source = await archiveSourceBytes({
          sourceKind: "ir",
          sourceDocumentId: document.id,
          companyId: document.companyId,
          sourceUrl: document.sourceUrl,
          bytes: content.bytes,
          contentType: content.kind === "pdf" ? "application/pdf" : content.kind === "catalog" ? "application/vnd.ai-infra.catalog+json" : "text/html; charset=utf-8",
        });
        const extracted = content.kind === "catalog"
          ? buildCatalogOnlyIrDetail(document, source.version.fetchedAt.toISOString())
          : content.kind === "pdf"
            ? await extractIrPdfDetail(content.bytes, document, source.version.fetchedAt.toISOString())
            : extractIrHtmlDetail(new TextDecoder().decode(content.bytes), document, source.version.fetchedAt.toISOString());
        const run = await recordBackfilledExtraction(source, current, extracted, Date.now() - startedAt);
        if (run.status === "preview") previews += 1;
      }
      archived += 1;
    } catch (error) {
      failed += 1;
      console.error(`${entry.kind.toUpperCase()} artifact backfill failed:`, error instanceof Error ? error.message : error);
    }
    if (index < queue.length - 1) await wait(250);
  }
  console.log(`Source artifact backfill: ${archived} archived, ${previews} parser previews, ${failed} failed.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
