import assert from "node:assert/strict";
import test from "node:test";
import { GET as startGitHubOAuth } from "@/app/api/auth/github/route";
import { authorizeApi, clearSessionCookie, oauthCookie, redirectResponse, safeReturnPath, sessionCookie } from "@/lib/auth/session";

test("auth return paths reject external and protocol-relative redirects", () => {
  assert.equal(safeReturnPath("/memos?company=coreweave"), "/memos?company=coreweave");
  assert.equal(safeReturnPath("//evil.example/path"), "/");
  assert.equal(safeReturnPath("https://evil.example/path"), "/");
  assert.equal(safeReturnPath(null), "/");
});

test("session cookies are http-only, same-site, and secure on https", () => {
  const request = new Request("https://terminal.example.com/");
  const value = sessionCookie("secret-token", request);
  assert.match(value, /HttpOnly/);
  assert.match(value, /SameSite=Lax/);
  assert.match(value, /Secure/);
  assert.doesNotMatch(value, /secret-token.*secret-token/);
  assert.match(clearSessionCookie(request), /Max-Age=0/);
  assert.match(oauthCookie("state", "csrf", request), /Max-Age=600/);
});

test("API authorization rejects requests without a session before database access", async () => {
  const result = await authorizeApi(new Request("http://localhost/api/protected"));
  const response = "response" in result ? result.response : null;
  assert.ok(response);
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Sign in is required." });
});

test("OAuth redirects retain mutable headers for state cookies", async () => {
  const response = redirectResponse("https://github.com/login/oauth/authorize");
  response.headers.append("Set-Cookie", "oauth_state=test");
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://github.com/login/oauth/authorize");
  assert.equal(response.headers.get("set-cookie"), "oauth_state=test");
});

test("GitHub OAuth start sets state cookies and a localhost callback", async () => {
  const previousClientId = process.env.GITHUB_CLIENT_ID;
  const previousClientSecret = process.env.GITHUB_CLIENT_SECRET;
  const previousBaseUrl = process.env.AUTH_BASE_URL;
  process.env.GITHUB_CLIENT_ID = "test-client-id";
  process.env.GITHUB_CLIENT_SECRET = "test-client-secret";
  process.env.AUTH_BASE_URL = "http://localhost:3002";
  try {
    const response = await startGitHubOAuth(new Request("http://localhost:3002/api/auth/github?returnTo=%2Fmemos"));
    const location = new URL(response.headers.get("location") ?? "");
    assert.equal(response.status, 302);
    assert.equal(location.origin, "https://github.com");
    assert.equal(location.searchParams.get("client_id"), "test-client-id");
    assert.equal(location.searchParams.get("redirect_uri"), "http://localhost:3002/api/auth/github/callback");
    assert.match(response.headers.get("set-cookie") ?? "", /ai_infra_oauth_state=/);
    assert.match(response.headers.get("set-cookie") ?? "", /ai_infra_oauth_return=/);
  } finally {
    if (previousClientId === undefined) delete process.env.GITHUB_CLIENT_ID; else process.env.GITHUB_CLIENT_ID = previousClientId;
    if (previousClientSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET; else process.env.GITHUB_CLIENT_SECRET = previousClientSecret;
    if (previousBaseUrl === undefined) delete process.env.AUTH_BASE_URL; else process.env.AUTH_BASE_URL = previousBaseUrl;
  }
});
