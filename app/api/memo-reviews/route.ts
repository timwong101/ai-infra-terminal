import { authorizeApi } from "@/lib/auth/session";
import { addMemoReviewComment, decideMemoReview, getMemoReviewWorkspace, resolveMemoReviewComment, submitMemoForReview } from "@/lib/reviews/service";

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
    const body = await request.json() as { memoId?: string; reviewerUserId?: string; note?: string };
    if (!body.memoId || !body.reviewerUserId) return Response.json({ error: "A memo and reviewer are required." }, { status: 400 });
    return Response.json({ review: await submitMemoForReview(body.memoId, body.reviewerUserId, body.note, authorized.auth) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to submit this memo." }, { status: 400 });
  }
}

export async function PUT(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { reviewId?: string; body?: string; claimKey?: string };
    if (!body.reviewId) return Response.json({ error: "A review ID is required." }, { status: 400 });
    return Response.json({ review: await addMemoReviewComment(body.reviewId, body.body ?? "", body.claimKey, authorized.auth) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to add this comment." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  const authorized = await authorizeApi(request, "analyst");
  if ("response" in authorized) return authorized.response;
  try {
    const body = await request.json() as { reviewId?: string; action?: "approved" | "changes_requested" | "resolve_comment"; note?: string; commentId?: string };
    if (!body.reviewId) return Response.json({ error: "A review ID is required." }, { status: 400 });
    if (!body.action || !["approved", "changes_requested", "resolve_comment"].includes(body.action)) return Response.json({ error: "A valid review action is required." }, { status: 400 });
    if (body.action === "resolve_comment" && !body.commentId) return Response.json({ error: "A comment ID is required." }, { status: 400 });
    const review = body.action === "resolve_comment"
      ? await resolveMemoReviewComment(body.reviewId, body.commentId!, authorized.auth)
      : await decideMemoReview(body.reviewId, body.action === "approved" ? "approved" : "changes_requested", body.note, authorized.auth);
    return Response.json({ review });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update this review." }, { status: 400 });
  }
}
