import { getResearchQualityRun } from "@/lib/research/research-quality";
import { authorizeApi } from "@/lib/auth/session";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const { id } = await context.params;
    return Response.json({ run: await getResearchQualityRun(decodeURIComponent(id), authorized.auth.workspace.id) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load this research quality run." }, { status: 404 });
  }
}
