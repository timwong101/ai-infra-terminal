import { createResearchAssistantSession, getResearchAssistantCatalog, listResearchAssistantSessions } from "@/lib/research/research-assistant";
import type { ResearchAssistantFilters } from "@/lib/research/types";

export async function GET() {
  try {
    const [sessions, catalog] = await Promise.all([listResearchAssistantSessions(), getResearchAssistantCatalog()]);
    return Response.json({ sessions, ...catalog }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load research history." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { filters?: Partial<ResearchAssistantFilters> };
    return Response.json({ id: await createResearchAssistantSession(body.filters) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create a research session." }, { status: 500 });
  }
}
