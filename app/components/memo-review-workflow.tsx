"use client";

import { Check, CheckCircle2, LoaderCircle, MessageSquareText, RotateCcw, Send, ShieldCheck, X } from "lucide-react";
import { useMemo, useState } from "react";
import type { ComparisonMemo } from "@/lib/research/types";
import type { MemoReview, MemoReviewWorkspace } from "@/lib/reviews/types";

export type ClaimCommentTarget = { key: string; label: string } | null;

const statusLabel: Record<ComparisonMemo["status"], string> = {
  draft: "Draft",
  in_review: "In review",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
};

export function MemoReviewWorkflow({ memo, workspace, commentTarget, onCommentTarget, onReviewChange }: {
  memo: ComparisonMemo;
  workspace: MemoReviewWorkspace | null;
  commentTarget: ClaimCommentTarget;
  onCommentTarget: (target: ClaimCommentTarget) => void;
  onReviewChange: (review: MemoReview, status?: ComparisonMemo["status"]) => void;
}) {
  const [submitOpen, setSubmitOpen] = useState(false);
  const [reviewerUserId, setReviewerUserId] = useState("");
  const [submissionNote, setSubmissionNote] = useState("");
  const [commentBody, setCommentBody] = useState("");
  const [decisionNote, setDecisionNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const review = workspace?.review ?? null;
  const eligibleReviewers = useMemo(() => workspace?.eligibleReviewers ?? [], [workspace?.eligibleReviewers]);
  const currentUserId = workspace?.currentUserId ?? "";
  const isReviewer = review?.reviewer.id === currentUserId;
  const isSubmitter = review?.submittedBy.id === currentUserId;
  const canComment = Boolean(review && (isReviewer || isSubmitter || workspace?.currentUserRole === "admin"));
  const openComments = review?.comments.filter((comment) => !comment.resolvedAt) ?? [];
  const activeReview = review?.status === "in_review" || review?.status === "changes_requested";

  const selectedReviewerUserId = eligibleReviewers.some((item) => item.userId === reviewerUserId)
    ? reviewerUserId
    : eligibleReviewers[0]?.userId ?? "";

  const commentLabels = useMemo(() => {
    const labels = new Map<string, string>();
    for (const section of memo.sections) {
      section.claims.forEach((claim, index) => labels.set(`${section.key}:${index}`, `${section.title} · ${claim.text.slice(0, 58)}`));
    }
    return labels;
  }, [memo.sections]);

  const submit = async () => {
    setBusy(true); setError("");
    const response = await fetch("/api/memo-reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memoId: memo.id, reviewerUserId: selectedReviewerUserId, note: submissionNote }),
    });
    const result = await response.json() as { review?: MemoReview; error?: string };
    setBusy(false);
    if (!response.ok || !result.review) { setError(result.error || "Unable to submit this memo."); return; }
    setSubmitOpen(false); setSubmissionNote("");
    onReviewChange(result.review, "in_review");
  };

  const comment = async () => {
    if (!review) return;
    setBusy(true); setError("");
    const response = await fetch("/api/memo-reviews", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: review.id, body: commentBody, claimKey: commentTarget?.key }),
    });
    const result = await response.json() as { review?: MemoReview; error?: string };
    setBusy(false);
    if (!response.ok || !result.review) { setError(result.error || "Unable to add this comment."); return; }
    setCommentBody(""); onCommentTarget(null); onReviewChange(result.review);
  };

  const resolve = async (commentId: string) => {
    if (!review) return;
    setBusy(true); setError("");
    const response = await fetch("/api/memo-reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: review.id, action: "resolve_comment", commentId }),
    });
    const result = await response.json() as { review?: MemoReview; error?: string };
    setBusy(false);
    if (!response.ok || !result.review) { setError(result.error || "Unable to resolve this comment."); return; }
    onReviewChange(result.review);
  };

  const decide = async (action: "approved" | "changes_requested") => {
    if (!review) return;
    setBusy(true); setError("");
    const response = await fetch("/api/memo-reviews", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewId: review.id, action, note: decisionNote }),
    });
    const result = await response.json() as { review?: MemoReview; error?: string };
    setBusy(false);
    if (!response.ok || !result.review) { setError(result.error || "Unable to record this decision."); return; }
    setDecisionNote(""); onReviewChange(result.review, action);
  };

  return <>
    <section className={`memo-review-workflow status-${memo.status}`} aria-label="Memo review workflow">
      <div className="memo-review-summary">
        <span className="memo-review-icon"><ShieldCheck size={17} /></span>
        <span>
          <strong>{statusLabel[memo.status]}</strong>
          <small>{review
            ? `${review.reviewer.name} · submitted ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(review.submittedAt))}`
            : "Independent approval is required before publication."}</small>
        </span>
        {openComments.length > 0 && <em>{openComments.length} open comment{openComments.length === 1 ? "" : "s"}</em>}
      </div>

      {!review && memo.status === "draft" && <button
        className="command-button"
        disabled={!workspace || !eligibleReviewers.length || workspace.currentUserRole === "viewer"}
        onClick={() => setSubmitOpen(true)}
      ><Send size={14} />Submit for review</button>}

      {memo.status === "changes_requested" && isSubmitter && <button className="command-button" onClick={() => setSubmitOpen(true)}>
        <RotateCcw size={14} />Resubmit
      </button>}

      {(memo.status === "approved" || memo.status === "published") && review?.status === "approved" && <span className="review-approved-by">
        <CheckCircle2 size={14} />Approved by {review.reviewer.name}
      </span>}
    </section>

    {review && <section className="memo-review-detail">
      {(review.submissionNote || review.decisionNote) && <div className="review-notes">
        {review.submissionNote && <p><strong>Submission note</strong>{review.submissionNote}</p>}
        {review.decisionNote && <p><strong>Reviewer decision</strong>{review.decisionNote}</p>}
      </div>}

      {review.comments.length > 0 && <div className="review-comments">
        {review.comments.map((item) => <article className={item.resolvedAt ? "resolved" : ""} key={item.id}>
          <MessageSquareText size={14} />
          <span><strong>{item.author.name}</strong><small>{item.claimKey ? commentLabels.get(item.claimKey) ?? "Memo claim" : "General review"}</small><p>{item.body}</p></span>
          {item.resolvedAt ? <em><Check size={12} />Resolved</em> : canComment && <button className="icon-button" aria-label="Resolve review comment" onClick={() => void resolve(item.id)}><Check size={13} /></button>}
        </article>)}
      </div>}

      {activeReview && canComment && <div className="review-comment-composer">
        <div><span>{commentTarget ? "Commenting on claim" : "General review comment"}</span>{commentTarget && <button onClick={() => onCommentTarget(null)}><X size={12} />Clear</button>}</div>
        <select
          aria-label="Review comment target"
          value={commentTarget?.key ?? ""}
          onChange={(event) => onCommentTarget(event.target.value
            ? { key: event.target.value, label: commentLabels.get(event.target.value) ?? "Memo claim" }
            : null)}
        >
          <option value="">General review</option>
          {[...commentLabels].map(([key, label]) => <option value={key} key={key}>{label}</option>)}
        </select>
        {commentTarget && <strong>{commentTarget.label}</strong>}
        <textarea aria-label="Review comment" rows={2} value={commentBody} onChange={(event) => setCommentBody(event.target.value)} placeholder="Add a specific, actionable review note..." />
        <button className="command-button" disabled={busy || commentBody.trim().length < 2} onClick={() => void comment()}><MessageSquareText size={14} />Add comment</button>
      </div>}

      {review.status === "in_review" && isReviewer && <div className="review-decision-controls">
        <textarea aria-label="Review decision note" rows={2} value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} placeholder="Decision note or required changes..." />
        <button className="command-button" disabled={busy} onClick={() => void decide("changes_requested")}><RotateCcw size={14} />Request changes</button>
        <button className="primary-button" disabled={busy || openComments.length > 0} onClick={() => void decide("approved")}><ShieldCheck size={14} />Approve memo</button>
      </div>}
      {error && <p className="review-workflow-error">{error}</p>}
    </section>}

    {submitOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSubmitOpen(false); }}>
      <section className="modal review-submit-modal" role="dialog" aria-modal="true" aria-labelledby="review-submit-title">
        <header className="modal-heading"><div><span className="section-kicker">Independent review</span><h2 id="review-submit-title">Submit memo for review</h2></div><button className="icon-button" onClick={() => setSubmitOpen(false)} aria-label="Close review submission"><X size={16} /></button></header>
        <label>Reviewer<select aria-label="Memo reviewer" value={selectedReviewerUserId} onChange={(event) => setReviewerUserId(event.target.value)}>{eligibleReviewers.map((item) => <option value={item.userId} key={item.userId}>{item.name} · {item.role}</option>)}</select></label>
        <label>Submission note<textarea aria-label="Review submission note" rows={3} value={submissionNote} onChange={(event) => setSubmissionNote(event.target.value)} placeholder="What should the reviewer focus on?" /></label>
        {!eligibleReviewers.length && <p className="review-workflow-error">Invite another analyst or admin before submitting this memo.</p>}
        {error && <p className="review-workflow-error">{error}</p>}
        <footer className="modal-actions"><button className="command-button" onClick={() => setSubmitOpen(false)}>Cancel</button><button className="primary-button" disabled={busy || !selectedReviewerUserId} onClick={() => void submit()}>{busy ? <LoaderCircle className="drawer-spinner" size={14} /> : <Send size={14} />}Submit</button></footer>
      </section>
    </div>}
  </>;
}
