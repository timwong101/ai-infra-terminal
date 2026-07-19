import { oauthCookie, OAUTH_RETURN_COOKIE, OAUTH_STATE_COOKIE, redirectResponse, safeReturnPath } from "@/lib/auth/session";

export async function GET(request: Request) {
  const clientId = process.env.GITHUB_CLIENT_ID?.trim();
  if (!clientId || !process.env.GITHUB_CLIENT_SECRET?.trim()) return Response.json({ error: "GitHub OAuth is not configured." }, { status: 503 });
  const url = new URL(request.url);
  const state = crypto.randomUUID();
  const returnTo = safeReturnPath(url.searchParams.get("returnTo") || "/home");
  const callback = `${process.env.AUTH_BASE_URL?.replace(/\/$/, "") || url.origin}/api/auth/github/callback`;
  const authorization = new URL("https://github.com/login/oauth/authorize");
  authorization.searchParams.set("client_id", clientId);
  authorization.searchParams.set("redirect_uri", callback);
  authorization.searchParams.set("scope", "user:email");
  authorization.searchParams.set("state", state);
  const response = redirectResponse(authorization);
  response.headers.append("Set-Cookie", oauthCookie(OAUTH_STATE_COOKIE, state, request));
  response.headers.append("Set-Cookie", oauthCookie(OAUTH_RETURN_COOKIE, returnTo, request));
  return response;
}
