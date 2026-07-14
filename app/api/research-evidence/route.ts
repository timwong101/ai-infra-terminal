import { listResearchEvidence, syncResearchEvidence, updateEvidenceReview } from "@/lib/research/evidence";
import type { EvidenceReviewStatus, ResearchSourceKind } from "@/lib/research/types";
import { generateResearchAlerts } from "@/lib/alerts/generate";

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const synced = params.get("sync") === "0" ? { sec: 0, ir: 0 } : await syncResearchEvidence();
    const result = await listResearchEvidence({
      query: params.get("q") ?? undefined,
      companyId: params.get("company") ?? undefined,
      topic: params.get("topic") ?? undefined,
      sourceKind: params.get("source") as ResearchSourceKind | undefined,
      reviewStatus: params.get("status") as EvidenceReviewStatus | undefined,
      dateFrom: params.get("dateFrom") ?? undefined,
    });
    return Response.json({ ...result, synced }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load research evidence." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { ids?: string[]; status?: EvidenceReviewStatus; note?: string };
    if (!body.ids?.length || !body.status || !["unreviewed", "accepted", "rejected"].includes(body.status)) {
      return Response.json({ error: "Evidence ids and a valid review status are required." }, { status: 400 });
    }
    const updated = await updateEvidenceReview(body.ids.slice(0, 1_000), body.status, body.note);
    const thesisSync = await generateResearchAlerts();
    return Response.json({ updated, thesisSync });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update evidence." }, { status: 500 });
  }
}
