import { createSession, oauthCookie, OAUTH_RETURN_COOKIE, OAUTH_STATE_COOKIE, readOAuthCookie, redirectResponse, safeReturnPath, sessionCookie, upsertGitHubIdentity } from "@/lib/auth/session";

type GitHubProfile = { id: number; login: string; name: string | null; email: string | null; avatar_url: string | null };
type GitHubEmail = { email: string; primary: boolean; verified: boolean };

function redirectWithError(request: Request, message: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("authError", message);
  return redirectResponse(url);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = readOAuthCookie(request, OAUTH_STATE_COOKIE);
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = process.env.GITHUB_CLIENT_SECRET?.trim();
  if (!code || !state || !expectedState || state !== expectedState) return redirectWithError(request, "GitHub sign-in state was invalid or expired.");
  if (!clientId || !clientSecret) return redirectWithError(request, "GitHub OAuth is not configured.");

  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }) });
    const tokenBody = await tokenResponse.json() as { access_token?: string; error_description?: string };
    if (!tokenResponse.ok || !tokenBody.access_token) throw new Error(tokenBody.error_description || "GitHub did not return an access token.");
    const headers = { Accept: "application/vnd.github+json", Authorization: `Bearer ${tokenBody.access_token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "AI-Infra-Terminal" };
    const [profileResponse, emailResponse] = await Promise.all([fetch("https://api.github.com/user", { headers }), fetch("https://api.github.com/user/emails", { headers })]);
    if (!profileResponse.ok) throw new Error("GitHub profile lookup failed.");
    const profile = await profileResponse.json() as GitHubProfile;
    const emails = emailResponse.ok ? await emailResponse.json() as GitHubEmail[] : [];
    const email = profile.email || emails.find((item) => item.primary && item.verified)?.email || emails.find((item) => item.verified)?.email;
    if (!email) throw new Error("A verified GitHub email address is required.");
    const identity = await upsertGitHubIdentity({ id: profile.id, login: profile.login, name: profile.name, email, avatarUrl: profile.avatar_url });
    const session = await createSession(identity.userId, identity.workspaceId);
    const returnTo = safeReturnPath(readOAuthCookie(request, OAUTH_RETURN_COOKIE));
    const response = redirectResponse(new URL(returnTo, request.url));
    response.headers.append("Set-Cookie", sessionCookie(session.token, request));
    response.headers.append("Set-Cookie", oauthCookie(OAUTH_STATE_COOKIE, "", request, 0));
    response.headers.append("Set-Cookie", oauthCookie(OAUTH_RETURN_COOKIE, "", request, 0));
    return response;
  } catch (error) {
    return redirectWithError(request, error instanceof Error ? error.message : "GitHub sign-in failed.");
  }
}
