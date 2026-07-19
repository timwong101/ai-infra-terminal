import { createSession, ensureDemoIdentity, isDemoAuthEnabled, sessionCookie } from "@/lib/auth/session";

export async function POST(request: Request) {
  if (!isDemoAuthEnabled()) return Response.json({ error: "Demo authentication is disabled." }, { status: 403 });
  try {
    const identity = await ensureDemoIdentity();
    const session = await createSession(identity.userId, identity.workspaceId);
    return Response.json({ authenticated: true }, { status: 201, headers: { "Set-Cookie": sessionCookie(session.token, request), "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to start a demo session." }, { status: 500 });
  }
}
