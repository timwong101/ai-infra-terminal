import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("scheduled ingestion uses the bounded direct runner without a disposable Redis service", async () => {
  const workflow = await readFile(new URL("../.github/workflows/research-ingestion.yml", import.meta.url), "utf8");
  assert.match(workflow, /pnpm research:cycle:scheduled/);
  assert.doesNotMatch(workflow, /services:\s*\n\s+redis:/);
});
