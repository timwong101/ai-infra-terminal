import { authorizeApi } from "@/lib/auth/session";
import { revokePublishedReport } from "@/lib/reports/service";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const { id } = await context.params;
    return Response.json({ report: await revokePublishedReport(decodeURIComponent(id), authorized.auth) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to revoke this report." }, { status: 404 });
  }
}
