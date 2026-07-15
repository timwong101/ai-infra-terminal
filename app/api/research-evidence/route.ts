import { listResearchEvidence, syncResearchEvidence, updateEvidenceReview } from "@/lib/research/evidence";
import type { EvidenceReviewStatus, EvidenceSuggestionStatus, ResearchEvidenceItem, ResearchSourceKind } from "@/lib/research/types";
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
    const body = await request.json() as {
      ids?: string[];
      status?: EvidenceReviewStatus;
      note?: string;
      suggestion?: { status?: EvidenceSuggestionStatus; claimId?: string; impact?: ResearchEvidenceItem["suggestedImpact"] };
    };
    if (!body.ids?.length || !body.status || !["unreviewed", "accepted", "rejected"].includes(body.status)) {
      return Response.json({ error: "Evidence ids and a valid review status are required." }, { status: 400 });
    }
    if (body.suggestion && (!body.suggestion.status || !["pending", "accepted", "rejected"].includes(body.suggestion.status))) {
      return Response.json({ error: "A valid suggestion decision is required." }, { status: 400 });
    }
    if (body.suggestion?.status === "accepted" && (!body.suggestion.claimId || !body.suggestion.impact)) {
      return Response.json({ error: "Accepted suggestions require a claim and impact." }, { status: 400 });
    }
    const reviewResult = await updateEvidenceReview(body.ids.slice(0, 1_000), body.status, body.note, body.suggestion?.status ? {
      status: body.suggestion.status,
      claimId: body.suggestion.claimId,
      impact: body.suggestion.impact,
    } : undefined);
    const thesisSync = await generateResearchAlerts();
    return Response.json({ ...reviewResult, thesisSync });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update evidence." }, { status: 500 });
  }
}
