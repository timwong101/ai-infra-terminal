import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("server-renders a route-safe loading shell", async () => {
  const html = await readFile(new URL("../.next/server/app/index.html", import.meta.url), "utf8");
  assert.match(html, /<title>AI Infrastructure Terminal<\/title>/i);
  assert.match(html, /Opening research workspace/);
  assert.doesNotMatch(html, /AI Infrastructure Map|CoreWeave \(CRWV\)/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
