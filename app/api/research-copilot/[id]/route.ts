import { getCopilotSession } from "@/lib/research/copilot";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return Response.json({ session: await getCopilotSession(decodeURIComponent(id)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load this research session." }, { status: 404 });
  }
}
