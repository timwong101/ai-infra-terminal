import { listResearchAlerts, updateResearchAlertStatus } from "@/lib/alerts/repository";
import { authorizeApi } from "@/lib/auth/session";
import { entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const alertUpdateSchema = z.object({ id: entityId, status: z.enum(["unread", "reviewed", "watching", "dismissed"]) }).strict();

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const params = new URL(request.url).searchParams;
    const result = await listResearchAlerts({
      status: params.get("status") ?? undefined,
      company: params.get("company") ?? undefined,
      category: params.get("category") ?? undefined,
      significance: params.get("significance") ?? undefined,
    }, authorized.auth);
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load research alerts." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, alertUpdateSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    return Response.json(await updateResearchAlertStatus(body.id, body.status, authorized.auth), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update this alert." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
