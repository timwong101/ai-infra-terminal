import { authorizeApi } from "@/lib/auth/session";
import { listPublishedReports, publishComparisonMemo } from "@/lib/reports/service";
import { entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const publishSchema = z.object({ memoId: entityId, complianceMode: z.boolean().default(true) });

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const memoId = new URL(request.url).searchParams.get("memoId")?.trim();
    if (!memoId) return Response.json({ error: "A memo ID is required." }, { status: 400 });
    return Response.json({ reports: await listPublishedReports(memoId, authorized.auth.workspace.id) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load published reports." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, publishSchema);
    if ("response" in parsed) return parsed.response;
    const report = await publishComparisonMemo(parsed.data.memoId, parsed.data.complianceMode, authorized.auth);
    return Response.json({ report }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to publish this report.";
    return Response.json({ error: message }, { status: message.includes("not found") ? 404 : 500 });
  }
}
