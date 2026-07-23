import { authorizeApi } from "@/lib/auth/session";
import { getLiveEventCatalog, refreshLiveEvents } from "@/lib/events/service";
import type { LiveEventSourceKind } from "@/lib/events/types";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const params = new URL(request.url).searchParams;
    const source = params.get("source");
    const catalog = await getLiveEventCatalog({
      companyId: params.get("company") || undefined,
      sourceKind: source === "official-ir" || source === "gdelt" ? source as LiveEventSourceKind : undefined,
      minimumMateriality: Number(params.get("minimumMateriality")) || undefined,
    });
    return Response.json(catalog, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load event intelligence." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const refresh = await refreshLiveEvents();
    return Response.json({ refresh, catalog: await getLiveEventCatalog() }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to refresh event intelligence." }, { status: 500 });
  }
}

