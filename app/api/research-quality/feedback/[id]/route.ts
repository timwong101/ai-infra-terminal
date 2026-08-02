import { authorizeApi } from "@/lib/auth/session";
import { adjudicateResearchQualityFeedback } from "@/lib/research/quality-feedback";
import { boundedText, entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const adjudicationSchema = z.object({
  action: z.enum(["adjudicate", "dismiss", "promote", "revise"]),
  expectedBehavior: boundedText(1_200).optional(),
  companyIds: z.array(entityId).max(12).optional(),
}).strict();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const { id } = await context.params;
    const parsed = await parseJsonBody(request, adjudicationSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const result = await adjudicateResearchQualityFeedback(authorized.auth, decodeURIComponent(id), body);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to adjudicate this quality issue." }, { status: 400 });
  }
}
