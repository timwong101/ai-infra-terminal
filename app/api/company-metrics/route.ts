import { authorizeApi } from "@/lib/auth/session";
import { getMetricLedger, reviewMetricObservation } from "@/lib/company-intelligence/metric-ledger";
import { boundedText, entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const metricReviewSchema = z.object({
  id: entityId,
  status: z.enum(["proposed", "accepted", "rejected"]),
  note: boundedText(2_000).optional(),
}).strict();

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json(await getMetricLedger(authorized.auth.workspace.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load metric observations." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, metricReviewSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    return Response.json(await reviewMetricObservation(body.id, body.status, body.note, authorized.auth));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to review metric observation." }, { status: 500 });
  }
}
