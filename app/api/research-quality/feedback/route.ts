import { authorizeApi } from "@/lib/auth/session";
import { createResearchQualityFeedback, listResearchQualityFeedback } from "@/lib/research/quality-feedback";
import type { ResearchQualityFailureType, ResearchQualityFeedback } from "@/lib/research/types";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json(
      { feedback: await listResearchQualityFeedback(authorized.auth.workspace.id) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load quality feedback." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as {
      sourceMessageId?: string;
      failureType?: ResearchQualityFailureType;
      severity?: ResearchQualityFeedback["severity"];
      summary?: string;
      expectedBehavior?: string;
    };
    const id = await createResearchQualityFeedback(authorized.auth, body);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to report this quality issue." }, { status: 400 });
  }
}
