import secEvidenceCacheJson from "@/data/generated/sec-evidence.json";
import type { EvidenceCache, SecEvidenceResponse } from "@/lib/evidence/types";
import { validateSecUserAgent } from "@/lib/sec/client";
import { refreshSecEvidence } from "@/lib/sec/ingest";
import { authorizeApi } from "@/lib/auth/session";

const REFRESH_TTL_MS = 5 * 60 * 1000;
const fallbackCache = secEvidenceCacheJson as unknown as EvidenceCache;

let runtimeCache = fallbackCache;
let lastSuccessfulRefresh = 0;
let refreshInFlight: Promise<EvidenceCache> | null = null;

async function getSecEvidence(): Promise<SecEvidenceResponse> {
  if (process.env.E2E_TEST === "1") {
    return { cache: fallbackCache, refresh: { status: "cached" } };
  }
  if (lastSuccessfulRefresh > 0 && Date.now() - lastSuccessfulRefresh < REFRESH_TTL_MS) {
    return { cache: runtimeCache, refresh: { status: "cached" } };
  }

  if (!refreshInFlight) {
    const userAgent = validateSecUserAgent(process.env.SEC_USER_AGENT);
    refreshInFlight = refreshSecEvidence({ userAgent, previousCache: runtimeCache })
      .then((cache) => {
        runtimeCache = cache;
        lastSuccessfulRefresh = Date.now();
        return cache;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }

  const cache = await refreshInFlight;
  return { cache, refresh: { status: "fresh" } };
}

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json(await getSecEvidence(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json(
      {
        cache: runtimeCache,
        refresh: {
          status: "stale",
          message: "SEC refresh is unavailable. Showing the last successful cache.",
        },
      } satisfies SecEvidenceResponse,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
