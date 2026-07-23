import { authorizeApi } from "@/lib/auth/session";
import { createResearchReplay, getResearchReplayCatalog } from "@/lib/replay/service";
import type { ReplayMode } from "@/lib/replay/types";

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
    const body = await request.json() as {
      companyIds?: string[];
      asOfDate?: string;
      mode?: ReplayMode;
      topic?: string;
      question?: string;
    };
    if (!body.companyIds?.length || !body.asOfDate) {
      return Response.json({ error: "At least one company and an as-of date are required." }, { status: 400 });
    }
    const run = await createResearchReplay({
      companyIds: body.companyIds,
      asOfDate: body.asOfDate,
      mode: body.mode === "publication-time" ? "publication-time" : "system-known",
      topic: body.topic || "All topics",
      question: body.question || "",
    }, authorized.auth);
    return Response.json({ run }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create research replay.";
    return Response.json({ error: message }, { status: /Select|Choose|valid|before today/.test(message) ? 400 : 500 });
  }
}

