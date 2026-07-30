import { authorizeApi } from "@/lib/auth/session";
import { adjudicateResearchQualityFeedback } from "@/lib/research/quality-feedback";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const { id } = await context.params;
    const body = await request.json() as {
      action?: "adjudicate" | "dismiss" | "promote" | "revise";
      expectedBehavior?: string;
      companyIds?: string[];
    };
    const result = await adjudicateResearchQualityFeedback(authorized.auth, decodeURIComponent(id), body);
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to adjudicate this quality issue." }, { status: 400 });
  }
}
