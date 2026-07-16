import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the AI infrastructure terminal", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>AI Infrastructure Terminal<\/title>/i);
  assert.match(html, /AI Infrastructure Map/);
  assert.match(html, /Infrastructure Themes/);
  assert.match(html, /Liquid Cooling/);
  assert.match(html, /Neoclouds/);
  assert.match(html, /CoreWeave \(CRWV\)/);
  assert.match(html, /Nebius \(NBIS\)/);
  assert.match(html, /Applied Digital \(APLD\)/);
  assert.match(html, /IREN \(IREN\)/);
  assert.match(html, /Live coverage/);
  assert.match(html, /Research roadmap/);
  assert.match(html, /Real source documents/);
  assert.match(html, /SEC (?:8-K|6-K|10-Q|20-F)/);
  assert.match(html, /sec\.gov\/Archives\/edgar\/data/);
  assert.doesNotMatch(html, /Liquid cooling backlog growth|Vertiv launches next-gen CDU/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
