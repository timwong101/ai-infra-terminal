import { getPublicReport, publishedReportToMarkdown } from "@/lib/reports/service";

function filename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "research-report";
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const report = await getPublicReport(decodeURIComponent(token));
  if (!report) return new Response("This report is unavailable or has been revoked.", { status: 404 });
  return new Response(publishedReportToMarkdown(report), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename(report.title)}-v${report.version}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
