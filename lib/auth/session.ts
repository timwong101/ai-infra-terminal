import { and, desc, eq, gt } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { auditEvents, authSessions, users, workspaceMembers, workspaces } from "@/lib/db/schema";
import type { AuditEventItem, AuthContext, WorkspaceRole } from "@/lib/auth/types";

export const SESSION_COOKIE = "ai_infra_session";
export const OAUTH_STATE_COOKIE = "ai_infra_oauth_state";
export const OAUTH_RETURN_COOKIE = "ai_infra_oauth_return";
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 14;
const ROLE_LEVEL: Record<WorkspaceRole, number> = { viewer: 0, analyst: 1, admin: 2 };

export class AuthError extends Error {
  constructor(message: string, readonly status: 401 | 403 = 401) { super(message); }
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

async function hashToken(value: string) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

function cookieValue(request: Request, name: string) {
  const cookies = request.headers.get("cookie") ?? "";
  for (const item of cookies.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return null;
}

function cookie(name: string, value: string, options: { maxAge: number; secure: boolean }) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${options.maxAge}${options.secure ? "; Secure" : ""}`;
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://app.local");
    return url.origin === "https://app.local" ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch { return "/"; }
}

export function sessionCookie(token: string, request: Request) {
  return cookie(SESSION_COOKIE, token, { maxAge: SESSION_AGE_SECONDS, secure: new URL(request.url).protocol === "https:" });
}

export function clearSessionCookie(request: Request) {
  return cookie(SESSION_COOKIE, "", { maxAge: 0, secure: new URL(request.url).protocol === "https:" });
}

export function oauthCookie(name: string, value: string, request: Request, maxAge = 600) {
  return cookie(name, value, { maxAge, secure: new URL(request.url).protocol === "https:" });
}

export function readOAuthCookie(request: Request, name: string) {
  return cookieValue(request, name);
}

export async function createSession(userId: string, workspaceId: string) {
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const id = `session:${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + SESSION_AGE_SECONDS * 1000);
  const row = await withDatabase((db) => db.insert(authSessions).values({ id, tokenHash, userId, activeWorkspaceId: workspaceId, expiresAt }).returning({ id: authSessions.id }));
  if (!row?.[0]) throw new Error("Postgres is required to create an authenticated session.");
  return { token, id };
}

export async function authenticateRequest(request: Request, minimumRole: WorkspaceRole = "viewer"): Promise<AuthContext> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) throw new AuthError("Sign in is required.");
  const tokenHash = await hashToken(token);
  const result = await withDatabase(async (db) => {
    const current = (await db.select({ session: authSessions, user: users, workspace: workspaces, membership: workspaceMembers })
      .from(authSessions)
      .innerJoin(users, eq(authSessions.userId, users.id))
      .innerJoin(workspaces, eq(authSessions.activeWorkspaceId, workspaces.id))
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, users.id)))
      .where(and(eq(authSessions.tokenHash, tokenHash), gt(authSessions.expiresAt, new Date()))).limit(1))[0];
    if (!current) return null;
    const memberships = await db.select({ workspace: workspaces, membership: workspaceMembers }).from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id)).where(eq(workspaceMembers.userId, current.user.id));
    await db.update(authSessions).set({ lastSeenAt: new Date() }).where(eq(authSessions.id, current.session.id));
    return { current, memberships };
  });
  if (!result) throw new AuthError("Your session is missing or expired.");
  const role = result.current.membership.role as WorkspaceRole;
  if (ROLE_LEVEL[role] < ROLE_LEVEL[minimumRole]) throw new AuthError(`The ${minimumRole} role is required for this action.`, 403);
  const workspace = { id: result.current.workspace.id, name: result.current.workspace.name, slug: result.current.workspace.slug, role };
  return {
    sessionId: result.current.session.id,
    user: { id: result.current.user.id, email: result.current.user.email, name: result.current.user.name, avatarUrl: result.current.user.avatarUrl },
    workspace,
    workspaces: result.memberships.map(({ workspace: item, membership }) => ({ id: item.id, name: item.name, slug: item.slug, role: membership.role as WorkspaceRole })),
  };
}

export async function authorizeApi(request: Request, minimumRole: WorkspaceRole = "viewer") {
  try { return { auth: await authenticateRequest(request, minimumRole) } as const; }
  catch (error) {
    const status = error instanceof AuthError ? error.status : 401;
    return { response: Response.json({ error: error instanceof Error ? error.message : "Unauthorized." }, { status, headers: { "Cache-Control": "no-store" } }) } as const;
  }
}

export async function deleteSession(request: Request) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  const tokenHash = await hashToken(token);
  await withDatabase((db) => db.delete(authSessions).where(eq(authSessions.tokenHash, tokenHash)));
}

export function isDemoAuthEnabled() {
  return process.env.ENABLE_DEMO_AUTH === "true" || process.env.NODE_ENV !== "production" || process.env.E2E_TEST === "1";
}

export async function ensureDemoIdentity() {
  const result = await withDatabase(async (db) => {
    await db.insert(users).values({ id: "user:demo", email: "demo@ai-infra.local", name: "Demo Analyst", provider: "demo", providerAccountId: "demo" }).onConflictDoNothing();
    await db.insert(workspaces).values({ id: "workspace:demo", name: "Neocloud Research", slug: "neocloud-research", createdByUserId: "user:demo" }).onConflictDoNothing();
    await db.insert(workspaceMembers).values({ id: "membership:demo", workspaceId: "workspace:demo", userId: "user:demo", role: "admin" }).onConflictDoNothing();
    return true;
  });
  if (!result) throw new Error("Postgres is required for demo authentication.");
  return { userId: "user:demo", workspaceId: "workspace:demo" };
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "research";
}

export async function upsertGitHubIdentity(profile: { id: number; login: string; name: string | null; email: string; avatarUrl: string | null }) {
  const providerAccountId = String(profile.id);
  const result = await withDatabase(async (db) => {
    let user = (await db.select().from(users).where(and(eq(users.provider, "github"), eq(users.providerAccountId, providerAccountId))).limit(1))[0];
    if (!user) user = (await db.insert(users).values({ id: `user:${crypto.randomUUID()}`, email: profile.email.toLowerCase(), name: profile.name?.trim() || profile.login, avatarUrl: profile.avatarUrl, provider: "github", providerAccountId }).onConflictDoUpdate({ target: users.email, set: { name: profile.name?.trim() || profile.login, avatarUrl: profile.avatarUrl, provider: "github", providerAccountId, updatedAt: new Date() } }).returning())[0];
    else user = (await db.update(users).set({ email: profile.email.toLowerCase(), name: profile.name?.trim() || profile.login, avatarUrl: profile.avatarUrl, updatedAt: new Date() }).where(eq(users.id, user.id)).returning())[0];
    let membership = (await db.select().from(workspaceMembers).where(eq(workspaceMembers.userId, user.id)).limit(1))[0];
    if (!membership) {
      const workspaceId = `workspace:${crypto.randomUUID()}`;
      const baseSlug = slugify(`${profile.login}-research`);
      const workspace = (await db.insert(workspaces).values({ id: workspaceId, name: `${profile.name?.trim() || profile.login}'s Research`, slug: `${baseSlug}-${workspaceId.slice(-6)}`, createdByUserId: user.id }).returning())[0];
      membership = (await db.insert(workspaceMembers).values({ id: `membership:${crypto.randomUUID()}`, workspaceId: workspace.id, userId: user.id, role: "admin" }).returning())[0];
    }
    return { userId: user.id, workspaceId: membership.workspaceId };
  });
  if (!result) throw new Error("Postgres is required for GitHub authentication.");
  return result;
}

export async function switchWorkspace(auth: AuthContext, workspaceId: string) {
  const result = await withDatabase(async (db) => {
    const membership = (await db.select().from(workspaceMembers).where(and(eq(workspaceMembers.userId, auth.user.id), eq(workspaceMembers.workspaceId, workspaceId))).limit(1))[0];
    if (!membership) return null;
    await db.update(authSessions).set({ activeWorkspaceId: workspaceId, lastSeenAt: new Date() }).where(eq(authSessions.id, auth.sessionId));
    return workspaceId;
  });
  if (!result) throw new AuthError("You are not a member of that workspace.", 403);
  return result;
}

export async function createWorkspace(auth: AuthContext, nameValue: string) {
  const name = nameValue.trim().slice(0, 80);
  if (name.length < 2) throw new Error("Workspace name must contain at least two characters.");
  const id = `workspace:${crypto.randomUUID()}`;
  const result = await withDatabase(async (db) => {
    const workspace = (await db.insert(workspaces).values({ id, name, slug: `${slugify(name)}-${id.slice(-6)}`, createdByUserId: auth.user.id }).returning())[0];
    await db.insert(workspaceMembers).values({ id: `membership:${crypto.randomUUID()}`, workspaceId: id, userId: auth.user.id, role: "admin" });
    await db.update(authSessions).set({ activeWorkspaceId: id, lastSeenAt: new Date() }).where(eq(authSessions.id, auth.sessionId));
    await db.insert(auditEvents).values({ id: `audit:${crypto.randomUUID()}`, workspaceId: id, actorUserId: auth.user.id, action: "workspace.created", entityType: "workspace", entityId: id, summary: `Created workspace ${name}.` });
    return workspace;
  });
  if (!result) throw new Error("Postgres is required to create a workspace.");
  return result;
}

export async function recordAuditEvent(auth: Pick<AuthContext, "user" | "workspace">, input: { action: string; entityType: string; entityId: string; summary: string; metadata?: Record<string, unknown> }) {
  await withDatabase((db) => db.insert(auditEvents).values({ id: `audit:${crypto.randomUUID()}`, workspaceId: auth.workspace.id, actorUserId: auth.user.id, ...input, metadata: input.metadata ?? {} }));
}

export async function listAuditEvents(auth: AuthContext, limit = 100): Promise<AuditEventItem[]> {
  const rows = await withDatabase((db) => db.select({ event: auditEvents, actor: users }).from(auditEvents).leftJoin(users, eq(auditEvents.actorUserId, users.id)).where(eq(auditEvents.workspaceId, auth.workspace.id)).orderBy(desc(auditEvents.createdAt)).limit(Math.max(1, Math.min(limit, 200))));
  if (!rows) throw new Error("Postgres is required for the audit trail.");
  return rows.map(({ event, actor }) => ({ id: event.id, action: event.action, entityType: event.entityType, entityId: event.entityId, summary: event.summary, metadata: event.metadata as Record<string, unknown>, actor: actor ? { id: actor.id, name: actor.name, email: actor.email } : null, createdAt: event.createdAt.toISOString() }));
}
