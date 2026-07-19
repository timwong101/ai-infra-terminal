import { createCopilotSession, getCopilotCatalog, listCopilotSessions } from "@/lib/research/copilot";
import type { CopilotFilters } from "@/lib/research/types";

export async function GET() {
  try {
    const [sessions, catalog] = await Promise.all([listCopilotSessions(), getCopilotCatalog()]);
    return Response.json({ sessions, ...catalog }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load research history." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { filters?: Partial<CopilotFilters> };
    return Response.json({ id: await createCopilotSession(body.filters) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create a research session." }, { status: 500 });
  }
}
