import type { WorkspaceRole } from "@/lib/auth/types";

export type WorkspaceMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatarUrl: string | null;
  role: WorkspaceRole;
  joinedAt: string;
};

export type WorkspaceInvitation = {
  id: string;
  email: string;
  role: WorkspaceRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  invitedBy: { id: string; name: string };
  expiresAt: string;
  createdAt: string;
  invitationPath?: string;
};

export type MemoReviewComment = {
  id: string;
  claimKey: string | null;
  body: string;
  author: { id: string; name: string; email: string };
  resolvedBy: { id: string; name: string } | null;
  resolvedAt: string | null;
  createdAt: string;
};

export type MemoReview = {
  id: string;
  memoId: string;
  status: "in_review" | "changes_requested" | "approved" | "cancelled";
  memoHash: string;
  submissionNote: string | null;
  decisionNote: string | null;
  submittedBy: { id: string; name: string; email: string };
  reviewer: { id: string; name: string; email: string };
  submittedAt: string;
  decidedAt: string | null;
  updatedAt: string;
  comments: MemoReviewComment[];
};

export type MemoReviewWorkspace = {
  review: MemoReview | null;
  eligibleReviewers: WorkspaceMember[];
  currentUserId: string;
  currentUserRole: WorkspaceRole;
};

export type InvitationPreview = {
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  status: WorkspaceInvitation["status"];
  expiresAt: string;
  emailMatches: boolean;
};
