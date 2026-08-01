import { authorizeApi } from "@/lib/auth/session";
import { getMetricLedger, reviewMetricObservation, type MetricReviewStatus } from "@/lib/company-intelligence/metric-ledger";
import { z } from "zod";

const metricReviewSchema = z.object({
  id: z.string().min(1).max(300),
  status: z.enum(["proposed", "accepted", "rejected"]),
  note: z.string().max(2_000).optional(),
});

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
    const parsed = metricReviewSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A metric id and valid review status are required.", issues: z.treeifyError(parsed.error) }, { status: 400 });
    const body = parsed.data as { id: string; status: MetricReviewStatus; note?: string };
    return Response.json(await reviewMetricObservation(body.id, body.status, body.note, authorized.auth));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to review metric observation." }, { status: 500 });
  }
}
