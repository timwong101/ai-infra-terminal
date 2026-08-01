import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";

const assetsDirectory = new URL("../dist/client/assets/", import.meta.url);
const manifestUrl = new URL("../dist/client/.vite/manifest.json", import.meta.url);
const MAX_ENTRY_BYTES = 200 * 1024;
const MAX_CLIENT_CHUNK_BYTES = 500 * 1024;

test("production client keeps the shell small and workspaces split", async () => {
  const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
  const pageEntry = manifest["app/page.tsx"];
  assert.ok(pageEntry?.file, "The app page must have a client manifest entry.");
  const entrySize = (await stat(new URL(pageEntry.file.replace(/^assets\//, ""), assetsDirectory))).size;
  assert.ok(entrySize <= MAX_ENTRY_BYTES, `App shell is ${entrySize} bytes; budget is ${MAX_ENTRY_BYTES}.`);

  const files = (await readdir(assetsDirectory)).filter((file) => file.endsWith(".js"));
  const oversized = [];
  for (const file of files) {
    const size = (await stat(new URL(file, assetsDirectory))).size;
    if (size > MAX_CLIENT_CHUNK_BYTES) oversized.push(`${file}: ${size}`);
  }
  assert.deepEqual(oversized, [], `Client chunks exceeded ${MAX_CLIENT_CHUNK_BYTES} bytes.`);

  for (const workspace of ["alerts", "company-intelligence", "comparison", "evidence", "lineage", "operations", "research-assistant", "research-quality"]) {
    assert.ok(files.some((file) => file.startsWith(`${workspace}-workspace-`)), `${workspace} must remain a lazy workspace chunk.`);
  }
});
