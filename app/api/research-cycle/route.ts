import { getResearchOperations } from "@/lib/operations/research-cycle";
import { authorizeApi } from "@/lib/auth/session";
import { cancelResearchCycle, enqueueResearchCycle, replayResearchCycle, retryResearchStage } from "@/lib/operations/queue";
import type { ResearchStageName } from "@/lib/operations/types";
import { z } from "zod";

const cycleControlSchema = z.object({
  runId: z.string().min(1).max(300),
  action: z.enum(["cancel", "retry_stage", "replay"]),
  stage: z.string().max(100).optional(),
});

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try { return Response.json(await getResearchOperations(authorized.auth.workspace.id), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load operations." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const secret = process.env.SCHEDULE_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-schedule-secret");
  let requestedByUserId: string | null = null;
  if (!secret || supplied !== secret) {
    const authorized = await authorizeApi(request, "admin");
    if ("response" in authorized) return authorized.response;
    requestedByUserId = authorized.auth.user.id;
  }
  try {
    const run = await enqueueResearchCycle({ trigger: request.headers.get("x-research-trigger") || "api", requestedByUserId });
    return Response.json({ run }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to queue the research cycle." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "admin");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = cycleControlSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "A run and valid control action are required.", issues: z.treeifyError(parsed.error) }, { status: 400 });
    const body = parsed.data as { runId: string; action: "cancel" | "retry_stage" | "replay"; stage?: ResearchStageName };
    if (body.action === "cancel") return Response.json(await cancelResearchCycle(body.runId));
    if (body.action === "replay") return Response.json({ run: await replayResearchCycle(body.runId, authorized.auth.user.id) }, { status: 202 });
    if (!body.stage) return Response.json({ error: "Choose the failed stage to retry." }, { status: 400 });
    return Response.json({ run: await retryResearchStage(body.runId, body.stage) }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update this research cycle." }, { status: 400 });
  }
}
