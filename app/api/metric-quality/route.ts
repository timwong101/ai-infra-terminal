import { authorizeApi } from "@/lib/auth/session";
import { getMetricQualityRun, listMetricQualityRuns, METRIC_QUALITY_FIXTURES, METRIC_QUALITY_SUITE_VERSION, runMetricQualitySuite } from "@/lib/company-intelligence/metric-quality";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) return Response.json({ run: await getMetricQualityRun(id, authorized.auth.workspace.id) });
    return Response.json({ runs: await listMetricQualityRuns(authorized.auth.workspace.id), suite: { version: METRIC_QUALITY_SUITE_VERSION, caseCount: METRIC_QUALITY_FIXTURES.length + 1 } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load metric quality." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json({ run: await runMetricQualitySuite(authorized.auth) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run metric quality." }, { status: 500 });
  }
}
