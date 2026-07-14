import type { AlertStatus } from "@/lib/alerts/types";
import { listResearchAlerts, updateResearchAlertStatus } from "@/lib/alerts/repository";

const VALID_STATUSES = new Set<AlertStatus>(["unread", "reviewed", "watching", "dismissed"]);

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const result = await listResearchAlerts({
      status: params.get("status") ?? undefined,
      company: params.get("company") ?? undefined,
      category: params.get("category") ?? undefined,
      significance: params.get("significance") ?? undefined,
    });
    return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to load research alerts." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { id?: string; status?: AlertStatus };
    if (!body.id || !body.status || !VALID_STATUSES.has(body.status)) {
      return Response.json({ error: "A valid alert id and status are required." }, { status: 400 });
    }
    return Response.json(await updateResearchAlertStatus(body.id, body.status), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update this alert." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
