import { listResearchQualityRuns, RESEARCH_QUALITY_BENCHMARKS, RESEARCH_QUALITY_SUITE_VERSION, runResearchQualitySuite } from "@/lib/research/research-quality";
import { authorizeApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json({
      runs: await listResearchQualityRuns(authorized.auth.workspace.id),
      suite: { version: RESEARCH_QUALITY_SUITE_VERSION, caseCount: RESEARCH_QUALITY_BENCHMARKS.length },
      aiAvailable: Boolean(process.env.OPENAI_API_KEY?.trim()),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load research quality history." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { engine?: "deterministic" | "ai" };
    const engine = body.engine === "ai" ? "ai" : "deterministic";
    const run = await runResearchQualitySuite(engine, authorized.auth);
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run the research quality suite." }, { status: 500 });
  }
}
