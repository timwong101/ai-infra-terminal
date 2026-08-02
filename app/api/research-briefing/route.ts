import { createResearchBriefing, createResearchBriefingsForAllWorkspaces } from "@/lib/operations/briefing";
import { authorizeApi } from "@/lib/auth/session";
import type { AuthContext } from "@/lib/auth/types";
import { parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const briefingSchema = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) });

export async function POST(request: Request) {
  const secret = process.env.SCHEDULE_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-schedule-secret");
  let auth: AuthContext | null = null;
  if (!secret || supplied !== secret) {
    const authorized = await authorizeApi(request, "analyst");
    if ("response" in authorized) return authorized.response;
    auth = authorized.auth;
  }
  try {
    const parsed = await parseJsonBody(request, briefingSchema);
    if ("response" in parsed) return parsed.response;
    const hours = parsed.data.hours;
    const until = new Date();
    const since = new Date(until.valueOf() - hours * 60 * 60 * 1_000);
    if (auth) return Response.json({ briefing: await createResearchBriefing({ workspaceId: auth.workspace.id, since, until }) }, { status: 201 });
    return Response.json({ briefings: await createResearchBriefingsForAllWorkspaces({ since, until }) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create research briefing." }, { status: 500 });
  }
}
