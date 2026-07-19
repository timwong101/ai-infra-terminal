import { getResearchQualityRun } from "@/lib/research/research-quality";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ run: await getResearchQualityRun(decodeURIComponent(id)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load this research quality run." }, { status: 404 });
  }
}
