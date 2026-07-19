export type WorkspaceRole = "viewer" | "analyst" | "admin";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
};

export type AuthenticatedWorkspace = {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
};

export type AuthContext = {
  sessionId: string;
  user: AuthenticatedUser;
  workspace: AuthenticatedWorkspace;
  workspaces: AuthenticatedWorkspace[];
};

export type AuditEventItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  summary: string;
  metadata: Record<string, unknown>;
  actor: { id: string; name: string; email: string } | null;
  createdAt: string;
};
