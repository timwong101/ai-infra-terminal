import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { AuthContext, WorkspaceRole } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";
import { withDatabase } from "@/lib/db/client";
import {
  authSessions,
  comparisonMemos,
  memoReviewComments,
  memoReviews,
  users,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from "@/lib/db/schema";
import type { ComparisonMemo, ComparisonMemoSection } from "@/lib/research/types";
import type {
  InvitationPreview,
  MemoReview,
  MemoReviewComment,
  MemoReviewWorkspace,
  WorkspaceInvitation,
  WorkspaceMember,
} from "@/lib/reviews/types";

const INVITATION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REVIEWER_ROLES = new Set<WorkspaceRole>(["analyst", "admin"]);
const VALID_ROLES = new Set<WorkspaceRole>(["viewer", "analyst", "admin"]);

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashValue(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function normalizedEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Enter a valid email address.");
  return email;
}

function roleValue(value: string): WorkspaceRole {
  if (!VALID_ROLES.has(value as WorkspaceRole)) throw new Error("Choose a valid workspace role.");
  return value as WorkspaceRole;
}

export async function comparisonMemoContentHash(input: ComparisonMemo | typeof comparisonMemos.$inferSelect) {
  const stored = "companyAId" in input;
  const payload = {
    id: input.id,
    title: input.title,
    question: input.question,
    topic: input.topic,
    companyAId: stored ? input.companyAId : input.companyA.id,
    companyBId: stored ? input.companyBId : input.companyB.id,
    confidenceScore: input.confidenceScore,
    evidenceQualityScore: input.evidenceQualityScore,
    sourceDiversityScore: input.sourceDiversityScore,
    sections: input.sections,
    evidence: stored ? input.evidenceSnapshot : input.citations,
  };
  return hashValue(JSON.stringify(payload));
}

function memberItem(member: typeof workspaceMembers.$inferSelect, user: typeof users.$inferSelect): WorkspaceMember {
  return {
    id: member.id,
    userId: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl,
    role: member.role as WorkspaceRole,
    joinedAt: member.joinedAt.toISOString(),
  };
}

function invitationStatus(invitation: typeof workspaceInvitations.$inferSelect): WorkspaceInvitation["status"] {
  return invitation.status === "pending" && invitation.expiresAt <= new Date() ? "expired" : invitation.status as WorkspaceInvitation["status"];
}

export async function listWorkspaceTeam(auth: AuthContext) {
  const result = await withDatabase(async (db) => {
    const memberRows = await db.select({ member: workspaceMembers, user: users }).from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, auth.workspace.id));
    const invitationRows = auth.workspace.role === "admin"
      ? await db.select({ invitation: workspaceInvitations, inviter: users }).from(workspaceInvitations)
        .innerJoin(users, eq(workspaceInvitations.invitedByUserId, users.id))
        .where(eq(workspaceInvitations.workspaceId, auth.workspace.id))
        .orderBy(desc(workspaceInvitations.createdAt))
      : [];
    return { memberRows, invitationRows };
  });
  if (!result) throw new Error("Postgres is required for workspace membership.");
  return {
    members: result.memberRows.map(({ member, user }) => memberItem(member, user)),
    invitations: result.invitationRows.map(({ invitation, inviter }) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role as WorkspaceRole,
      status: invitationStatus(invitation),
      invitedBy: { id: inviter.id, name: inviter.name },
      expiresAt: invitation.expiresAt.toISOString(),
      createdAt: invitation.createdAt.toISOString(),
    } satisfies WorkspaceInvitation)),
  };
}

export async function createWorkspaceInvitation(emailValue: string, roleInput: string, auth: AuthContext) {
  const email = normalizedEmail(emailValue);
  const role = roleValue(roleInput);
  const token = randomToken();
  const tokenHash = await hashValue(token);
  const id = `invitation:${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + INVITATION_AGE_MS);
  const stored = await withDatabase(async (db) => db.transaction(async (tx) => {
    const existing = (await tx.select({ membership: workspaceMembers.id }).from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(and(eq(workspaceMembers.workspaceId, auth.workspace.id), eq(users.email, email))).limit(1))[0];
    if (existing) throw new Error("That person is already a member of this workspace.");
    await tx.update(workspaceInvitations).set({ status: "revoked" }).where(and(
      eq(workspaceInvitations.workspaceId, auth.workspace.id),
      eq(workspaceInvitations.email, email),
      eq(workspaceInvitations.status, "pending"),
    ));
    return (await tx.insert(workspaceInvitations).values({
      id,
      workspaceId: auth.workspace.id,
      email,
      role,
      tokenHash,
      invitedByUserId: auth.user.id,
      expiresAt,
    }).returning())[0];
  }));
  if (!stored) throw new Error("Postgres is required to create an invitation.");
  await recordAuditEvent(auth, {
    action: "workspace.invitation_created",
    entityType: "workspace_invitation",
    entityId: id,
    summary: `Invited ${email} as ${role}.`,
    metadata: { email, role, expiresAt: expiresAt.toISOString() },
  });
  return {
    id,
    email,
    role,
    status: "pending" as const,
    invitedBy: { id: auth.user.id, name: auth.user.name },
    expiresAt: expiresAt.toISOString(),
    createdAt: stored.createdAt.toISOString(),
    invitationPath: `/invite/${token}`,
  } satisfies WorkspaceInvitation;
}

export async function revokeWorkspaceInvitation(id: string, auth: AuthContext) {
  const row = await withDatabase((db) => db.update(workspaceInvitations).set({ status: "revoked" }).where(and(
    eq(workspaceInvitations.id, id),
    eq(workspaceInvitations.workspaceId, auth.workspace.id),
    eq(workspaceInvitations.status, "pending"),
  )).returning());
  if (!row?.[0]) throw new Error("Pending invitation not found.");
  await recordAuditEvent(auth, { action: "workspace.invitation_revoked", entityType: "workspace_invitation", entityId: id, summary: `Revoked the invitation for ${row[0].email}.` });
  return true;
}

async function ensureAnotherAdmin(workspaceId: string, excludedMemberId: string) {
  const rows = await withDatabase((db) => db.select({ id: workspaceMembers.id }).from(workspaceMembers).where(and(
    eq(workspaceMembers.workspaceId, workspaceId),
    eq(workspaceMembers.role, "admin"),
    sql`${workspaceMembers.id} <> ${excludedMemberId}`,
  )).limit(1));
  return Boolean(rows?.length);
}

async function hasActiveReviewAssignment(workspaceId: string, userId: string) {
  const rows = await withDatabase((db) => db.select({ id: memoReviews.id }).from(memoReviews).where(and(
    eq(memoReviews.workspaceId, workspaceId),
    eq(memoReviews.reviewerUserId, userId),
    eq(memoReviews.status, "in_review"),
  )).limit(1));
  return Boolean(rows?.length);
}

export async function updateWorkspaceMemberRole(memberId: string, roleInput: string, auth: AuthContext) {
  const role = roleValue(roleInput);
  const current = await withDatabase((db) => db.select().from(workspaceMembers).where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, auth.workspace.id))).limit(1));
  if (!current?.[0]) throw new Error("Workspace member not found.");
  if (current[0].role === "admin" && role !== "admin" && !await ensureAnotherAdmin(auth.workspace.id, memberId)) throw new Error("A workspace must keep at least one admin.");
  if (role === "viewer" && await hasActiveReviewAssignment(auth.workspace.id, current[0].userId)) throw new Error("Complete this member's active memo reviews before changing them to viewer.");
  const row = await withDatabase((db) => db.update(workspaceMembers).set({ role }).where(eq(workspaceMembers.id, memberId)).returning());
  if (!row?.[0]) throw new Error("Unable to update this member.");
  await recordAuditEvent(auth, { action: "workspace.member_role_changed", entityType: "workspace_member", entityId: memberId, summary: `Changed a workspace member to ${role}.`, metadata: { userId: row[0].userId, role } });
  return true;
}

export async function removeWorkspaceMember(memberId: string, auth: AuthContext) {
  const current = await withDatabase((db) => db.select().from(workspaceMembers).where(and(eq(workspaceMembers.id, memberId), eq(workspaceMembers.workspaceId, auth.workspace.id))).limit(1));
  if (!current?.[0]) throw new Error("Workspace member not found.");
  if (current[0].userId === auth.user.id) throw new Error("Transfer administration before removing yourself.");
  if (current[0].role === "admin" && !await ensureAnotherAdmin(auth.workspace.id, memberId)) throw new Error("A workspace must keep at least one admin.");
  if (await hasActiveReviewAssignment(auth.workspace.id, current[0].userId)) throw new Error("Complete this member's active memo reviews before removing them.");
  await withDatabase((db) => db.delete(workspaceMembers).where(eq(workspaceMembers.id, memberId)));
  await recordAuditEvent(auth, { action: "workspace.member_removed", entityType: "workspace_member", entityId: memberId, summary: "Removed a member from the workspace.", metadata: { userId: current[0].userId } });
  return true;
}

async function invitationForToken(token: string) {
  const tokenHash = await hashValue(token);
  return withDatabase(async (db) => (await db.select({ invitation: workspaceInvitations, workspace: workspaces }).from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaceInvitations.workspaceId, workspaces.id))
    .where(eq(workspaceInvitations.tokenHash, tokenHash)).limit(1))[0] ?? null);
}

export async function previewWorkspaceInvitation(token: string, auth: AuthContext): Promise<InvitationPreview> {
  const row = await invitationForToken(token);
  if (!row) throw new Error("This invitation is unavailable.");
  return {
    workspaceName: row.workspace.name,
    email: row.invitation.email,
    role: row.invitation.role as WorkspaceRole,
    status: invitationStatus(row.invitation),
    expiresAt: row.invitation.expiresAt.toISOString(),
    emailMatches: row.invitation.email === auth.user.email.toLowerCase(),
  };
}

export async function acceptWorkspaceInvitation(token: string, auth: AuthContext) {
  const row = await invitationForToken(token);
  if (!row) throw new Error("This invitation is unavailable.");
  if (invitationStatus(row.invitation) !== "pending") throw new Error("This invitation is no longer active.");
  if (row.invitation.email !== auth.user.email.toLowerCase()) throw new Error(`Sign in as ${row.invitation.email} to accept this invitation.`);
  const now = new Date();
  await withDatabase((db) => db.transaction(async (tx) => {
    await tx.insert(workspaceMembers).values({ id: `membership:${crypto.randomUUID()}`, workspaceId: row.workspace.id, userId: auth.user.id, role: row.invitation.role }).onConflictDoUpdate({
      target: [workspaceMembers.workspaceId, workspaceMembers.userId],
      set: { role: row.invitation.role },
    });
    await tx.update(workspaceInvitations).set({ status: "accepted", acceptedByUserId: auth.user.id, acceptedAt: now }).where(eq(workspaceInvitations.id, row.invitation.id));
    await tx.update(authSessions).set({ activeWorkspaceId: row.workspace.id, lastSeenAt: now }).where(eq(authSessions.id, auth.sessionId));
  }));
  await recordAuditEvent({ ...auth, workspace: { ...auth.workspace, id: row.workspace.id, name: row.workspace.name, slug: row.workspace.slug, role: row.invitation.role as WorkspaceRole } }, {
    action: "workspace.invitation_accepted",
    entityType: "workspace_invitation",
    entityId: row.invitation.id,
    summary: `${auth.user.name} joined ${row.workspace.name}.`,
    metadata: { role: row.invitation.role },
  });
  return { id: row.workspace.id, name: row.workspace.name };
}

async function memoInWorkspace(memoId: string, workspaceId: string) {
  return withDatabase(async (db) => (await db.select().from(comparisonMemos).where(and(eq(comparisonMemos.id, memoId), eq(comparisonMemos.workspaceId, workspaceId))).limit(1))[0] ?? null);
}

async function reviewUsers(workspaceId: string) {
  const rows = await withDatabase((db) => db.select({ member: workspaceMembers, user: users }).from(workspaceMembers)
    .innerJoin(users, eq(workspaceMembers.userId, users.id)).where(eq(workspaceMembers.workspaceId, workspaceId)));
  return rows ?? [];
}

async function reviewItem(review: typeof memoReviews.$inferSelect, workspaceId: string): Promise<MemoReview> {
  const [memberRows, comments] = await Promise.all([
    reviewUsers(workspaceId),
    withDatabase((db) => db.select().from(memoReviewComments).where(eq(memoReviewComments.reviewId, review.id)).orderBy(memoReviewComments.createdAt)),
  ]);
  const userById = new Map(memberRows.map(({ user }) => [user.id, user]));
  const participantIds = [...new Set([
    review.submittedByUserId,
    review.reviewerUserId,
    ...(comments ?? []).flatMap((comment) => [comment.authorUserId, comment.resolvedByUserId].filter(Boolean) as string[]),
  ])];
  if (participantIds.length) {
    const extraUsers = await withDatabase((db) => db.select().from(users).where(inArray(users.id, participantIds)));
    for (const user of extraUsers ?? []) userById.set(user.id, user);
  }
  const submitter = userById.get(review.submittedByUserId);
  const reviewer = userById.get(review.reviewerUserId);
  if (!submitter || !reviewer) throw new Error("Review participants are unavailable.");
  return {
    id: review.id,
    memoId: review.memoId,
    status: review.status as MemoReview["status"],
    memoHash: review.memoHash,
    submissionNote: review.submissionNote,
    decisionNote: review.decisionNote,
    submittedBy: { id: submitter.id, name: submitter.name, email: submitter.email },
    reviewer: { id: reviewer.id, name: reviewer.name, email: reviewer.email },
    submittedAt: review.submittedAt.toISOString(),
    decidedAt: review.decidedAt?.toISOString() ?? null,
    updatedAt: review.updatedAt.toISOString(),
    comments: (comments ?? []).map((comment) => {
      const author = userById.get(comment.authorUserId)!;
      const resolver = comment.resolvedByUserId ? userById.get(comment.resolvedByUserId) : null;
      return {
        id: comment.id,
        claimKey: comment.claimKey,
        body: comment.body,
        author: { id: author.id, name: author.name, email: author.email },
        resolvedBy: resolver ? { id: resolver.id, name: resolver.name } : null,
        resolvedAt: comment.resolvedAt?.toISOString() ?? null,
        createdAt: comment.createdAt.toISOString(),
      } satisfies MemoReviewComment;
    }),
  };
}

export async function getMemoReviewWorkspace(memoId: string, auth: AuthContext): Promise<MemoReviewWorkspace> {
  const memo = await memoInWorkspace(memoId, auth.workspace.id);
  if (!memo) throw new Error("Memo not found in this workspace.");
  const [latest, memberRows] = await Promise.all([
    withDatabase(async (db) => (await db.select().from(memoReviews).where(and(eq(memoReviews.memoId, memoId), eq(memoReviews.workspaceId, auth.workspace.id))).orderBy(desc(memoReviews.submittedAt)).limit(1))[0] ?? null),
    reviewUsers(auth.workspace.id),
  ]);
  const eligibleReviewers = memberRows.filter(({ member }) => REVIEWER_ROLES.has(member.role as WorkspaceRole) && member.userId !== memo.ownerUserId).map(({ member, user }) => memberItem(member, user));
  return { review: latest ? await reviewItem(latest, auth.workspace.id) : null, eligibleReviewers, currentUserId: auth.user.id, currentUserRole: auth.workspace.role };
}

export async function submitMemoForReview(memoId: string, reviewerUserId: string, submissionNote: string | undefined, auth: AuthContext) {
  const memo = await memoInWorkspace(memoId, auth.workspace.id);
  if (!memo) throw new Error("Memo not found in this workspace.");
  if (memo.ownerUserId !== auth.user.id && auth.workspace.role !== "admin") throw new Error("Only the memo owner or a workspace admin can submit it.");
  if (memo.isStale) throw new Error("Regenerate this stale memo before requesting review.");
  if (memo.status === "in_review") throw new Error("This memo is already in review.");
  if (memo.status === "approved" || memo.status === "published") throw new Error("This memo has already been approved.");
  if (reviewerUserId === memo.ownerUserId) throw new Error("A memo author cannot approve their own work.");
  const reviewer = await withDatabase(async (db) => (await db.select().from(workspaceMembers).where(and(
    eq(workspaceMembers.workspaceId, auth.workspace.id),
    eq(workspaceMembers.userId, reviewerUserId),
  )).limit(1))[0] ?? null);
  if (!reviewer || !REVIEWER_ROLES.has(reviewer.role as WorkspaceRole)) throw new Error("Choose an analyst or admin reviewer from this workspace.");
  const memoHash = await comparisonMemoContentHash(memo);
  const id = `memo-review:${crypto.randomUUID()}`;
  const row = await withDatabase((db) => db.transaction(async (tx) => {
    const stored = (await tx.insert(memoReviews).values({ id, workspaceId: auth.workspace.id, memoId, submittedByUserId: auth.user.id, reviewerUserId, memoHash, submissionNote: submissionNote?.trim().slice(0, 1000) || null }).returning())[0];
    await tx.update(comparisonMemos).set({ status: "in_review" }).where(eq(comparisonMemos.id, memoId));
    return stored;
  }));
  if (!row) throw new Error("Postgres is required for memo review.");
  await recordAuditEvent(auth, { action: "memo.review_submitted", entityType: "comparison_memo", entityId: memoId, summary: `Submitted ${memo.title} for review.`, metadata: { reviewId: id, reviewerUserId, memoHash } });
  return reviewItem(row, auth.workspace.id);
}

function validClaimKey(claimKey: string | undefined, sections: ComparisonMemoSection[]) {
  if (!claimKey) return null;
  const [sectionKey, indexValue] = claimKey.split(":");
  const index = Number(indexValue);
  const section = sections.find((item) => item.key === sectionKey);
  if (!section || !Number.isInteger(index) || index < 0 || index >= section.claims.length) throw new Error("The selected memo claim is unavailable.");
  return `${sectionKey}:${index}`;
}

export async function addMemoReviewComment(reviewId: string, bodyValue: string, claimKeyValue: string | undefined, auth: AuthContext) {
  const body = bodyValue.trim().slice(0, 2000);
  if (body.length < 2) throw new Error("Enter a review comment.");
  const row = await withDatabase(async (db) => (await db.select({ review: memoReviews, memo: comparisonMemos }).from(memoReviews)
    .innerJoin(comparisonMemos, eq(memoReviews.memoId, comparisonMemos.id))
    .where(and(eq(memoReviews.id, reviewId), eq(memoReviews.workspaceId, auth.workspace.id))).limit(1))[0] ?? null);
  if (!row) throw new Error("Memo review not found.");
  if (row.review.status !== "in_review" && row.review.status !== "changes_requested") throw new Error("Comments are closed for this review.");
  if (![row.review.submittedByUserId, row.review.reviewerUserId].includes(auth.user.id) && auth.workspace.role !== "admin") throw new Error("Only review participants can comment.");
  const claimKey = validClaimKey(claimKeyValue, row.memo.sections as ComparisonMemoSection[]);
  const id = `memo-comment:${crypto.randomUUID()}`;
  await withDatabase((db) => db.insert(memoReviewComments).values({ id, workspaceId: auth.workspace.id, memoId: row.memo.id, reviewId, authorUserId: auth.user.id, claimKey, body }));
  await recordAuditEvent(auth, { action: "memo.review_commented", entityType: "memo_review", entityId: reviewId, summary: `Commented on ${row.memo.title}.`, metadata: { memoId: row.memo.id, commentId: id, claimKey } });
  return (await getMemoReviewWorkspace(row.memo.id, auth)).review!;
}

export async function resolveMemoReviewComment(reviewId: string, commentId: string, auth: AuthContext) {
  const review = await withDatabase(async (db) => (await db.select().from(memoReviews).where(and(eq(memoReviews.id, reviewId), eq(memoReviews.workspaceId, auth.workspace.id))).limit(1))[0] ?? null);
  if (!review) throw new Error("Memo review not found.");
  if (![review.submittedByUserId, review.reviewerUserId].includes(auth.user.id) && auth.workspace.role !== "admin") throw new Error("Only review participants can resolve comments.");
  const rows = await withDatabase((db) => db.update(memoReviewComments).set({ resolvedAt: new Date(), resolvedByUserId: auth.user.id }).where(and(eq(memoReviewComments.id, commentId), eq(memoReviewComments.reviewId, reviewId))).returning());
  if (!rows?.[0]) throw new Error("Review comment not found.");
  await recordAuditEvent(auth, { action: "memo.review_comment_resolved", entityType: "memo_review_comment", entityId: commentId, summary: "Resolved a memo review comment.", metadata: { reviewId, memoId: review.memoId } });
  return (await getMemoReviewWorkspace(review.memoId, auth)).review!;
}

export async function decideMemoReview(reviewId: string, decision: "approved" | "changes_requested", noteValue: string | undefined, auth: AuthContext) {
  const row = await withDatabase(async (db) => (await db.select({ review: memoReviews, memo: comparisonMemos }).from(memoReviews)
    .innerJoin(comparisonMemos, eq(memoReviews.memoId, comparisonMemos.id))
    .where(and(eq(memoReviews.id, reviewId), eq(memoReviews.workspaceId, auth.workspace.id))).limit(1))[0] ?? null);
  if (!row) throw new Error("Memo review not found.");
  if (row.review.reviewerUserId !== auth.user.id) throw new Error("Only the assigned reviewer can make this decision.");
  if (row.review.status !== "in_review") throw new Error("This review is no longer awaiting a decision.");
  const note = noteValue?.trim().slice(0, 2000) || null;
  if (decision === "changes_requested" && !note) throw new Error("Explain the requested changes before returning the memo.");
  const currentHash = await comparisonMemoContentHash(row.memo);
  if (currentHash !== row.review.memoHash) throw new Error("The memo changed after submission. Submit the current version for a new review.");
  if (row.memo.isStale) throw new Error("The evidence packet changed after submission. Regenerate the memo before approval.");
  if (decision === "approved") {
    const openComments = await withDatabase((db) => db.select({ id: memoReviewComments.id }).from(memoReviewComments).where(and(eq(memoReviewComments.reviewId, reviewId), sql`${memoReviewComments.resolvedAt} IS NULL`)).limit(1));
    if (openComments?.length) throw new Error("Resolve all review comments before approving this memo.");
  }
  const now = new Date();
  await withDatabase((db) => db.transaction(async (tx) => {
    await tx.update(memoReviews).set({ status: decision, decisionNote: note, decidedAt: now, updatedAt: now }).where(eq(memoReviews.id, reviewId));
    await tx.update(comparisonMemos).set({ status: decision === "approved" ? "approved" : "changes_requested" }).where(eq(comparisonMemos.id, row.memo.id));
  }));
  await recordAuditEvent(auth, { action: decision === "approved" ? "memo.review_approved" : "memo.review_changes_requested", entityType: "comparison_memo", entityId: row.memo.id, summary: decision === "approved" ? `Approved ${row.memo.title}.` : `Requested changes to ${row.memo.title}.`, metadata: { reviewId, memoHash: currentHash, note } });
  return (await getMemoReviewWorkspace(row.memo.id, auth)).review!;
}

export async function approvedReviewSnapshot(memo: ComparisonMemo, workspaceId: string) {
  if (memo.isStale) throw new Error("Regenerate this stale memo before publishing.");
  if (memo.status !== "approved" && memo.status !== "published") throw new Error("This memo must be approved before it can be published.");
  const review = await withDatabase(async (db) => (await db.select({ review: memoReviews, reviewer: users }).from(memoReviews)
    .innerJoin(users, eq(memoReviews.reviewerUserId, users.id))
    .where(and(eq(memoReviews.memoId, memo.id), eq(memoReviews.workspaceId, workspaceId), eq(memoReviews.status, "approved")))
    .orderBy(desc(memoReviews.decidedAt)).limit(1))[0] ?? null);
  if (!review?.review.decidedAt) throw new Error("An approved review record is required before publishing.");
  const currentHash = await comparisonMemoContentHash(memo);
  if (currentHash !== review.review.memoHash) throw new Error("The approved memo snapshot no longer matches the current memo.");
  return {
    reviewId: review.review.id,
    approvedBy: review.reviewer.name,
    approvedByEmail: review.reviewer.email,
    approvedAt: review.review.decidedAt.toISOString(),
    decisionNote: review.review.decisionNote,
    memoHash: review.review.memoHash,
  };
}
