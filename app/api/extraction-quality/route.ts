import { authorizeApi } from "@/lib/auth/session";
import {
  getExtractionQualityRun,
  listExtractionBenchmarkCases,
  listExtractionQualityRuns,
  listParserReleases,
  promoteParserRelease,
  runExtractionQualitySuite,
} from "@/lib/extraction-quality/service";
import { EXTRACTION_PARSER_CANDIDATE, EXTRACTION_QUALITY_SUITE_VERSION } from "@/lib/extraction-quality/corpus";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const id = new URL(request.url).searchParams.get("id");
    if (id) return Response.json({ run: await getExtractionQualityRun(id, authorized.auth.workspace.id) }, { headers: { "Cache-Control": "private, no-store" } });
    const [runs, cases, releases] = await Promise.all([
      listExtractionQualityRuns(authorized.auth.workspace.id),
      listExtractionBenchmarkCases(),
      listParserReleases(authorized.auth.workspace.id),
    ]);
    return Response.json({
      runs,
      cases,
      releases,
      suite: { version: EXTRACTION_QUALITY_SUITE_VERSION, parserVersion: EXTRACTION_PARSER_CANDIDATE, caseCount: cases.length },
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load source extraction quality." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json().catch(() => ({})) as { action?: "run" | "promote"; runId?: string };
    if (body.action === "promote") {
      if (!body.runId) return Response.json({ error: "runId is required for parser promotion." }, { status: 400 });
      return Response.json({ release: await promoteParserRelease(body.runId, authorized.auth) });
    }
    return Response.json({ run: await runExtractionQualitySuite(authorized.auth) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run source extraction quality." }, { status: 500 });
  }
}
