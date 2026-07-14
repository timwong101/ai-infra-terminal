import { getCompanyIntelligence, syncCompanyIntelligence } from "@/lib/company-intelligence/service";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
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
