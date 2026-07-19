import { getCompanyIntelligence, syncCompanyIntelligence } from "@/lib/company-intelligence/service";
import { authorizeApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const authorized = await authorizeApi(request, params.get("sync") === "1" ? "analyst" : "viewer");
  if ("response" in authorized) return authorized.response;
  try {
    if (params.get("sync") === "1") await syncCompanyIntelligence();
    return Response.json(await getCompanyIntelligence(
      params.get("company") ?? undefined,
      params.get("current") ?? undefined,
      params.get("previous") ?? undefined,
    ), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load company intelligence." }, { status: 503 });
  }
}
