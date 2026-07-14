import irEvidenceCacheJson from "@/data/generated/ir-evidence.json";
import { refreshIrEvidence } from "@/lib/ir/ingest";
import { syncIrCatalog } from "@/lib/ir/pipeline";
import type { IrEvidenceCache, IrEvidenceResponse } from "@/lib/ir/types";

const REFRESH_TTL_MS = 15 * 60 * 1000;
const fallbackCache = irEvidenceCacheJson as unknown as IrEvidenceCache;
let runtimeCache = fallbackCache;
let lastSuccessfulRefresh = 0;
let refreshInFlight: Promise<IrEvidenceCache> | null = null;

async function getIrEvidence(): Promise<IrEvidenceResponse> {
  if (lastSuccessfulRefresh > 0 && Date.now() - lastSuccessfulRefresh < REFRESH_TTL_MS) {
    return { cache: runtimeCache, refresh: { status: "cached" } };
  }
  if (!refreshInFlight) {
    refreshInFlight = refreshIrEvidence({ previousCache: runtimeCache })
      .then((cache) => {
        runtimeCache = cache;
        lastSuccessfulRefresh = Date.now();
        return cache;
      })
      .finally(() => { refreshInFlight = null; });
  }
  return { cache: await refreshInFlight, refresh: { status: "fresh" } };
}

export async function GET() {
  try {
    const result = await getIrEvidence();
    const ingestion = await syncIrCatalog(result.cache) ?? undefined;
    return Response.json({ ...result, ingestion }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    const result = {
      cache: runtimeCache,
      refresh: { status: "stale", message: "IR refresh is unavailable. Showing the last successful cache." },
    } satisfies IrEvidenceResponse;
    const ingestion = await syncIrCatalog(runtimeCache).catch(() => null) ?? undefined;
    return Response.json({ ...result, ingestion }, { headers: { "Cache-Control": "private, no-store" } });
  }
}
