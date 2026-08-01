import { authorizeApi } from "@/lib/auth/session";
import { addMemoReviewComment, decideMemoReview, getMemoReviewWorkspace, resolveMemoReviewComment, submitMemoForReview } from "@/lib/reviews/service";
import { boundedText, entityId, parseJsonBody } from "@/lib/http/validation";
import { z } from "zod";

const submitSchema = z.object({ memoId: entityId, reviewerUserId: entityId, note: boundedText(2_000).optional() });
const commentSchema = z.object({ reviewId: entityId, body: boundedText(4_000).min(1), claimKey: boundedText(300).optional() });
const decisionSchema = z.discriminatedUnion("action", [
  z.object({ reviewId: entityId, action: z.literal("resolve_comment"), commentId: entityId, note: z.undefined().optional() }),
  z.object({ reviewId: entityId, action: z.enum(["approved", "changes_requested"]), note: boundedText(2_000).optional(), commentId: z.undefined().optional() }),
]);

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const memoId = new URL(request.url).searchParams.get("memoId")?.trim();
    if (!memoId) return Response.json({ error: "A memo ID is required." }, { status: 400 });
    return Response.json(await getMemoReviewWorkspace(memoId, authorized.auth), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load memo review." }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, submitSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    return Response.json({ review: await submitMemoForReview(body.memoId, body.reviewerUserId, body.note, authorized.auth) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to submit this memo." }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, commentSchema);
    if ("response" in parsed) return parsed.response;
    return Response.json({ review: await addMemoReviewComment(parsed.data.reviewId, parsed.data.body, parsed.data.claimKey, authorized.auth) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to add this comment." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const parsed = await parseJsonBody(request, decisionSchema);
    if ("response" in parsed) return parsed.response;
    const body = parsed.data;
    const review = body.action === "resolve_comment"
      ? await resolveMemoReviewComment(body.reviewId, body.commentId, authorized.auth)
      : await decideMemoReview(body.reviewId, body.action === "approved" ? "approved" : "changes_requested", body.note, authorized.auth);
    return Response.json({ review });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update this review." }, { status: 400 });
  }
}
