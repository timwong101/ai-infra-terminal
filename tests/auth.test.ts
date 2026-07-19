import assert from "node:assert/strict";
import test from "node:test";
import { authorizeApi, clearSessionCookie, oauthCookie, safeReturnPath, sessionCookie } from "@/lib/auth/session";

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
  assert.ok("response" in result);
  assert.equal(result.response.status, 401);
  assert.deepEqual(await result.response.json(), { error: "Sign in is required." });
});
