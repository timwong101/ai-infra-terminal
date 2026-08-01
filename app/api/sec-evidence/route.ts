import secEvidenceCacheJson from "@/data/generated/sec-evidence.json";
import type { EvidenceCache, SecEvidenceResponse } from "@/lib/evidence/types";
import { authorizeApi } from "@/lib/auth/session";
import { getPersistedSecSnapshot, secSnapshotResponse } from "@/lib/dashboard/source-snapshots";

const fallbackCache = secEvidenceCacheJson as unknown as EvidenceCache;

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  const persisted = await getPersistedSecSnapshot();
  return Response.json(secSnapshotResponse(persisted ?? fallbackCache, persisted ? "postgres" : "bundled") satisfies SecEvidenceResponse, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
