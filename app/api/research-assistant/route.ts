import { createResearchAssistantSession, getResearchAssistantCatalog, listResearchAssistantSessions } from "@/lib/research/research-assistant";
import type { ResearchAssistantFilters } from "@/lib/research/types";
import { authorizeApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const [sessions, catalog] = await Promise.all([listResearchAssistantSessions(authorized.auth.workspace.id), getResearchAssistantCatalog()]);
    return Response.json({ sessions, ...catalog }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load research history." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { filters?: Partial<ResearchAssistantFilters> };
    return Response.json({ id: await createResearchAssistantSession(authorized.auth, body.filters) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create a research session." }, { status: 500 });
  }
}
