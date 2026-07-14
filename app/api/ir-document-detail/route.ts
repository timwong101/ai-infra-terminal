import irEvidenceCacheJson from "@/data/generated/ir-evidence.json";
import { irSources } from "@/data/ir-sources";
import { getIrSourceDocument, getPersistedIrDocumentDetail, persistIrDocumentDetail } from "@/lib/db/ir-evidence-repository";
import { fetchIrDocumentContent } from "@/lib/ir/client";
import { extractIrHtmlDetail, extractIrPdfDetail } from "@/lib/ir/extract";
import type { IrDocumentDetail, IrDocumentDetailResponse, IrEvidenceCache } from "@/lib/ir/types";

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
    inFlight = fetchIrDocumentContent(config, document)
      .then((content) => content.kind === "pdf"
        ? extractIrPdfDetail(content.bytes, document)
        : extractIrHtmlDetail(content.html, document))
      .then((detail) => {
        detailCache.set(documentId, { detail, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
        return detail;
      })
      .finally(() => requestsInFlight.delete(documentId));
    requestsInFlight.set(documentId, inFlight);
  }

  const detail = await inFlight;
  let persisted = false;
  try { persisted = await persistIrDocumentDetail(detail); } catch { persisted = false; }
  return { detail, cacheStatus: "fresh" as const, persisted };
}

export async function GET(request: Request) {
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
