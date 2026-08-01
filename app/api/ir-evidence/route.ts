import irEvidenceCacheJson from "@/data/generated/ir-evidence.json";
import type { IrEvidenceCache, IrEvidenceResponse } from "@/lib/ir/types";
import { authorizeApi } from "@/lib/auth/session";
import { getPersistedIrSnapshot, irSnapshotResponse } from "@/lib/dashboard/source-snapshots";

const fallbackCache = irEvidenceCacheJson as unknown as IrEvidenceCache;

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  const persisted = await getPersistedIrSnapshot();
  return Response.json(irSnapshotResponse(persisted ?? fallbackCache, persisted ? "postgres" : "bundled") satisfies IrEvidenceResponse, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
