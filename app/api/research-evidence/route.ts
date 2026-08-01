import { listResearchEvidence, syncResearchEvidence, updateEvidenceReview } from "@/lib/research/evidence";
import type { EvidenceReviewStatus, EvidenceSuggestionStatus, ResearchEvidenceItem, ResearchSourceKind } from "@/lib/research/types";
import { authorizeApi } from "@/lib/auth/session";
import { z } from "zod";

const evidenceReviewSchema = z.object({
  ids: z.array(z.string().min(1).max(500)).min(1).max(1_000),
  status: z.enum(["unreviewed", "accepted", "rejected"]),
  note: z.string().max(2_000).optional(),
  suggestion: z.object({
    status: z.enum(["pending", "accepted", "rejected"]),
    claimId: z.string().min(1).max(500).optional(),
    impact: z.enum(["supports", "weakens", "watch"]).optional(),
  }).optional(),
}).superRefine((value, context) => {
  if (value.suggestion?.status === "accepted" && (!value.suggestion.claimId || !value.suggestion.impact)) {
    context.addIssue({ code: "custom", message: "Accepted suggestions require a claim and impact.", path: ["suggestion"] });
  }
});

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const params = new URL(request.url).searchParams;
    const synced = process.env.E2E_TEST === "1" || params.get("sync") === "0"
      ? { sec: 0, ir: 0 }
      : await syncResearchEvidence();
    const result = await listResearchEvidence(authorized.auth.workspace.id, {
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
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = evidenceReviewSchema.safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Evidence ids and a valid review decision are required.", issues: z.treeifyError(parsed.error) }, { status: 400 });
    const body = parsed.data as {
      ids: string[]; status: EvidenceReviewStatus; note?: string;
      suggestion?: { status: EvidenceSuggestionStatus; claimId?: string; impact?: ResearchEvidenceItem["suggestedImpact"] };
    };
    const reviewResult = await updateEvidenceReview(body.ids.slice(0, 1_000), body.status, body.note, body.suggestion?.status ? {
      status: body.suggestion.status,
      claimId: body.suggestion.claimId,
      impact: body.suggestion.impact,
    } : undefined, authorized.auth);
    return Response.json(reviewResult);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update evidence." }, { status: 500 });
  }
}
