import { listResearchQualityRuns, RESEARCH_QUALITY_BENCHMARKS, RESEARCH_QUALITY_GATES, RESEARCH_QUALITY_SUITE_VERSION, runResearchQualitySuite } from "@/lib/research/research-quality";
import { authorizeApi } from "@/lib/auth/session";
import { parseJsonBody } from "@/lib/http/validation";
import { listResearchQualityCases, listResearchQualityFeedback } from "@/lib/research/quality-feedback";
import { z } from "zod";

const qualityRunSchema = z.object({ engine: z.enum(["deterministic", "ai"]).default("deterministic") });

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const [runs, feedback, cases] = await Promise.all([
      listResearchQualityRuns(authorized.auth.workspace.id),
      listResearchQualityFeedback(authorized.auth.workspace.id),
      listResearchQualityCases(authorized.auth.workspace.id),
    ]);
    return Response.json({
      runs,
      feedback,
      cases,
      suite: {
        version: RESEARCH_QUALITY_SUITE_VERSION,
        caseCount: RESEARCH_QUALITY_BENCHMARKS.length + cases.filter((item) => item.status === "active").length,
        gates: RESEARCH_QUALITY_GATES,
      },
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
    const parsed = await parseJsonBody(request, qualityRunSchema);
    if ("response" in parsed) return parsed.response;
    const engine = parsed.data.engine;
    const run = await runResearchQualitySuite(engine, authorized.auth);
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to run the research quality suite." }, { status: 500 });
  }
}
