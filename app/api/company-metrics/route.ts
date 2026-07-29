import { authorizeApi } from "@/lib/auth/session";
import { getMetricLedger, reviewMetricObservation, type MetricReviewStatus } from "@/lib/company-intelligence/metric-ledger";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json(await getMetricLedger(), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load metric observations." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { id?: string; status?: MetricReviewStatus; note?: string };
    if (!body.id || !body.status || !["proposed", "accepted", "rejected"].includes(body.status)) {
      return Response.json({ error: "A metric id and valid review status are required." }, { status: 400 });
    }
    return Response.json(await reviewMetricObservation(body.id, body.status, body.note, authorized.auth));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to review metric observation." }, { status: 500 });
  }
}
