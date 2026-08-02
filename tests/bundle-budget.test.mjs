import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import test from "node:test";

const assetsDirectory = new URL("../.next/static/chunks/", import.meta.url);
const MAX_SHELL_BYTES = 160 * 1024;
const MAX_CLIENT_CHUNK_BYTES = 550 * 1024;

async function chunkContaining(files, marker) {
  for (const file of files) {
    if ((await readFile(new URL(file, assetsDirectory), "utf8")).includes(marker)) return file;
  }
  return null;
}

test("production client keeps the shell small and workspaces split", async () => {
  const files = (await readdir(assetsDirectory)).filter((file) => file.endsWith(".js"));
  const shellChunk = await chunkContaining(files, "Opening analyst workspace");
  assert.ok(shellChunk, "The authenticated shell must have a discoverable client chunk.");
  const shellSize = (await stat(new URL(shellChunk, assetsDirectory))).size;
  assert.ok(shellSize <= MAX_SHELL_BYTES, `Authenticated shell is ${shellSize} bytes; budget is ${MAX_SHELL_BYTES}.`);

  const oversized = [];
  for (const file of files) {
    const size = (await stat(new URL(file, assetsDirectory))).size;
    if (size > MAX_CLIENT_CHUNK_BYTES) oversized.push(`${file}: ${size}`);
  }
  assert.deepEqual(oversized, [], `Client chunks exceeded ${MAX_CLIENT_CHUNK_BYTES} bytes.`);

  for (const [workspace, marker] of Object.entries({
    alerts: "Thesis Alerts",
    companies: "Company Intelligence",
    comparison: "Comparison Memos",
    evidence: "Evidence Review",
    lineage: "Claim-to-Evidence Lineage",
    operations: "Activity & Briefings",
    assistant: "Unsupported claims are rejected",
    quality: "Regression History",
  })) {
    const chunk = await chunkContaining(files, marker);
    assert.ok(chunk, `${workspace} must remain a discoverable lazy workspace chunk.`);
    assert.notEqual(chunk, shellChunk, `${workspace} must not be absorbed into the authenticated shell chunk.`);
  }
});
