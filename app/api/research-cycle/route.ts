import { getResearchOperations, runResearchCycle } from "@/lib/operations/research-cycle";

export async function GET() {
  try { return Response.json(await getResearchOperations(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Unable to load operations." }, { status: 503 }); }
}

export async function POST(request: Request) {
  const secret = process.env.SCHEDULE_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-schedule-secret");
  if (secret && supplied !== secret && process.env.NODE_ENV === "production") return Response.json({ error: "Unauthorized." }, { status: 401 });
  try { return Response.json(await runResearchCycle(request.headers.get("x-research-trigger") || "api"), { status: 202 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Research cycle failed." }, { status: 500 }); }
}
