import secEvidenceCacheJson from "@/data/generated/sec-evidence.json";
import type { EvidenceCache, SecEvidenceResponse } from "@/lib/evidence/types";
import { authorizeApi } from "@/lib/auth/session";

const fallbackCache = secEvidenceCacheJson as unknown as EvidenceCache;

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  return Response.json({ cache: fallbackCache, refresh: { status: "cached" } } satisfies SecEvidenceResponse, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
