import { getResearchOperations } from "@/lib/operations/research-cycle";
import { authorizeApi } from "@/lib/auth/session";
import { cancelResearchCycle, enqueueResearchCycle, replayResearchCycle, retryResearchStage } from "@/lib/operations/queue";
import { RESEARCH_STAGE_NAMES } from "@/lib/operations/types";
import { entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const cycleControlSchema = z.object({
  runId: entityId,
  action: z.enum(["cancel", "retry_stage", "replay"]),
  stage: z.enum(RESEARCH_STAGE_NAMES).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === "retry_stage" && !value.stage) context.addIssue({ code: "custom", message: "Choose the failed stage to retry.", path: ["stage"] });
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
    const parsed = await parseJsonBody(request, cycleControlSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    if (body.action === "cancel") return Response.json(await cancelResearchCycle(body.runId));
    if (body.action === "replay") return Response.json({ run: await replayResearchCycle(body.runId, authorized.auth.user.id) }, { status: 202 });
    return Response.json({ run: await retryResearchStage(body.runId, body.stage!) }, { status: 202 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update this research cycle." }, { status: 400 });
  }
}
