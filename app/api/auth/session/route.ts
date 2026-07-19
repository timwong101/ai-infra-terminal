import { authenticateRequest, clearSessionCookie, deleteSession, isDemoAuthEnabled } from "@/lib/auth/session";

export async function GET(request: Request) {
  try {
    const auth = await authenticateRequest(request);
    return Response.json({ authenticated: true, ...auth, demoAvailable: isDemoAuthEnabled(), githubAvailable: Boolean(process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim()) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ authenticated: false, demoAvailable: isDemoAuthEnabled(), githubAvailable: Boolean(process.env.GITHUB_CLIENT_ID?.trim() && process.env.GITHUB_CLIENT_SECRET?.trim()) }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  }
}

export async function DELETE(request: Request) {
  await deleteSession(request);
  return Response.json({ authenticated: false }, { headers: { "Set-Cookie": clearSessionCookie(request), "Cache-Control": "no-store" } });
}
