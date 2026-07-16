import { createResearchBriefing } from "@/lib/operations/briefing";

export async function POST(request: Request) {
  const secret = process.env.SCHEDULE_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || request.headers.get("x-schedule-secret");
  if (secret && supplied !== secret && process.env.NODE_ENV === "production") return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const body = await request.json().catch(() => ({})) as { hours?: number };
    const hours = Math.max(1, Math.min(168, Number(body.hours) || 24));
    const until = new Date();
    const briefing = await createResearchBriefing({ since: new Date(until.valueOf() - hours * 60 * 60 * 1_000), until });
    return Response.json({ briefing }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create research briefing." }, { status: 500 });
  }
}
