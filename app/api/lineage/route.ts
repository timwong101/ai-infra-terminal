import { authorizeApi } from "@/lib/auth/session";
import { buildLineageGraph } from "@/lib/lineage/service";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json(await buildLineageGraph(authorized.auth.workspace.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to build evidence lineage." }, { status: 503 });
  }
}

