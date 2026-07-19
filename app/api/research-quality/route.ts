import { listResearchQualityRuns, RESEARCH_QUALITY_BENCHMARKS, RESEARCH_QUALITY_SUITE_VERSION, runResearchQualitySuite } from "@/lib/research/research-quality";

export async function GET() {
  try {
    return Response.json({
      runs: await listResearchQualityRuns(),
      suite: { version: RESEARCH_QUALITY_SUITE_VERSION, caseCount: RESEARCH_QUALITY_BENCHMARKS.length },
      aiAvailable: Boolean(process.env.OPENAI_API_KEY?.trim()),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load research quality history." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { engine?: "deterministic" | "ai" };
    const engine = body.engine === "ai" ? "ai" : "deterministic";
    const run = await runResearchQualitySuite(engine);
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run the research quality suite." }, { status: 500 });
  }
}
