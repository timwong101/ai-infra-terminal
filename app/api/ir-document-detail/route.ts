import irEvidenceCacheJson from "@/data/generated/ir-evidence.json";
import { irSources } from "@/data/ir-sources";
import { getIrSourceDocument, getPersistedIrDocumentDetail, persistIrDocumentDetail } from "@/lib/db/ir-evidence-repository";
import { fetchIrDocumentContent } from "@/lib/ir/client";
import { buildCatalogOnlyIrDetail, extractIrHtmlDetail, extractIrPdfDetail } from "@/lib/ir/extract";
import type { IrDocumentDetail, IrDocumentDetailResponse, IrEvidenceCache } from "@/lib/ir/types";
import { authorizeApi } from "@/lib/auth/session";
import { archiveSourceBytes, recordInitialExtraction } from "@/lib/artifacts/service";

const cache = irEvidenceCacheJson as unknown as IrEvidenceCache;
const DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const detailCache = new Map<string, { expiresAt: number; detail: IrDocumentDetail }>();
const requestsInFlight = new Map<string, Promise<IrDocumentDetail>>();

async function loadDocumentDetail(documentId: string) {
  try {
    const persisted = await getPersistedIrDocumentDetail(documentId);
    if (persisted) return { detail: persisted, cacheStatus: "cached" as const, persisted: true };
  } catch {
    // Continue with on-demand extraction when the optional database is unavailable.
  }

  const catalogDocument = await getIrSourceDocument(documentId).catch(() => null);
  const document = catalogDocument ?? cache.documents.find((candidate) => candidate.id === documentId);
  if (!document) throw new Error("Invalid IR document identifier.");
  const config = irSources.find((candidate) => candidate.companyId === document.companyId);
  if (!config) throw new Error("IR document company is not configured.");

  const cached = detailCache.get(documentId);
  if (cached && cached.expiresAt > Date.now()) return { detail: cached.detail, cacheStatus: "cached" as const, persisted: false };

  let inFlight = requestsInFlight.get(documentId);
  if (!inFlight) {
    const extractionStartedAt = Date.now();
    const isCatalogOnly = config.catalogOnlyHosts?.includes(new URL(document.sourceUrl).hostname) ?? false;
    inFlight = (isCatalogOnly
      ? Promise.resolve({ kind: "catalog" as const, bytes: new TextEncoder().encode(JSON.stringify(document)) })
      : fetchIrDocumentContent(config, document).then((content) => content.kind === "pdf"
        ? { kind: "pdf" as const, bytes: content.bytes }
        : { kind: "html" as const, bytes: new TextEncoder().encode(content.html) }))
      .then(async (content) => {
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
        if (!persisted) throw new Error("Postgres is required for durable IR extraction.");
        await recordInitialExtraction(archived, detail, Date.now() - extractionStartedAt);
        detailCache.set(documentId, { detail, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
        return detail;
      })
      .finally(() => requestsInFlight.delete(documentId));
    requestsInFlight.set(documentId, inFlight);
  }

  const detail = await inFlight;
  return { detail, cacheStatus: "fresh" as const, persisted: true };
}

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const documentId = new URL(request.url).searchParams.get("id") ?? "";
    if (!documentId || documentId.length > 180) throw new Error("Invalid IR document identifier.");
    const result = await loadDocumentDetail(documentId);
    const response: IrDocumentDetailResponse = {
      detail: result.detail,
      cacheStatus: result.cacheStatus,
      persistence: result.persisted ? "postgres" : "memory",
    };
    return Response.json(response, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to extract this IR document.";
    return Response.json({ error: message }, {
      status: message.startsWith("Invalid") ? 400 : 502,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
