import irEvidenceCacheJson from "@/data/generated/ir-evidence.json";
import type { IrEvidenceCache, IrEvidenceResponse } from "@/lib/ir/types";
import { authorizeApi } from "@/lib/auth/session";

const fallbackCache = irEvidenceCacheJson as unknown as IrEvidenceCache;

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  return Response.json({ cache: fallbackCache, refresh: { status: "cached" } } satisfies IrEvidenceResponse, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
