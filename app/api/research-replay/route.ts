import { authorizeApi } from "@/lib/auth/session";
import { createResearchReplay, getResearchReplayCatalog } from "@/lib/replay/service";
import { boundedText, entityId, isoDate, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const replaySchema = z.object({
  companyIds: z.array(entityId).min(1).max(12),
  asOfDate: isoDate,
  mode: z.enum(["system-known", "publication-time"]).default("system-known"),
  topic: boundedText(120).default("All topics"),
  question: boundedText(2_000).default(""),
}).strict();

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    return Response.json(await getResearchReplayCatalog(authorized.auth.workspace.id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load research replay." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, replaySchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const run = await createResearchReplay({
      companyIds: body.companyIds,
      asOfDate: body.asOfDate,
      mode: body.mode,
      topic: body.topic,
      question: body.question,
    }, authorized.auth);
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create research replay.";
    return Response.json({ error: message }, { status: /Select|Choose|valid|before today/.test(message) ? 400 : 500 });
  }
}
