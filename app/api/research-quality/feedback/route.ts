import { authorizeApi } from "@/lib/auth/session";
import { createResearchQualityFeedback, listResearchQualityFeedback } from "@/lib/research/quality-feedback";
import { boundedText, entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const feedbackSchema = z.object({
  sourceMessageId: entityId,
  failureType: z.enum(["wrong-retrieval", "unsupported-claim", "citation-mismatch", "incorrect-metric", "stale-source", "missing-evidence", "should-abstain", "incorrect-answer"]),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  summary: boundedText(800).min(1),
  expectedBehavior: boundedText(1_200).optional(),
}).strict();

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
    const parsed = await parseJsonBody(request, feedbackSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const id = await createResearchQualityFeedback(authorized.auth, body);
    return Response.json({ id }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to report this quality issue." }, { status: 400 });
  }
}
