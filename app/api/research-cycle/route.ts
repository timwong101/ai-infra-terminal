import { getResearchOperations, runResearchCycle } from "@/lib/operations/research-cycle";
import { authorizeApi } from "@/lib/auth/session";

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try { return Response.json(await getResearchOperations(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load operations." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const secret = process.env.SCHEDULE_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-schedule-secret");
  if (!secret || supplied !== secret) {
    const authorized = await authorizeApi(request, "analyst");
    if ("response" in authorized) return authorized.response;
  }
  try { return Response.json(await runResearchCycle(request.headers.get("x-research-trigger") || "api"), { status: 202 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Research cycle failed." }, { status: 500 }); }
}
