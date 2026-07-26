import { getPublicReport } from "@/lib/reports/service";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const report = await getPublicReport(decodeURIComponent(token));
  if (!report) {
    return Response.json({ error: "This report is unavailable or has been revoked." }, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return Response.json({ report }, {
    headers: { "Cache-Control": "no-store" },
  });
}
