import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { boundedText, entityId, parseJsonBody } from "@/lib/http/validation";

const schema = z.object({ id: entityId, note: boundedText(12).optional() });

test("validated JSON bodies normalize bounded input", async () => {
  const result = await parseJsonBody(new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "  memo:one  ", note: " concise " }),
  }), schema);
  assert.ok("data" in result);
  if ("data" in result) assert.deepEqual(result.data, { id: "memo:one", note: "concise" });
});

test("validated JSON bodies reject malformed and oversized input", async () => {
  const malformed = await parseJsonBody(new Request("http://localhost/api/test", { method: "POST", body: "{" }), schema);
  assert.ok("response" in malformed);
  if ("response" in malformed) assert.equal(malformed.response.status, 400);

  const invalid = await parseJsonBody(new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: "", note: "this note is much too long" }),
  }), schema);
  assert.ok("response" in invalid);
  if ("response" in invalid) {
    assert.equal(invalid.response.status, 400);
    const body = await invalid.response.json() as { issues?: unknown };
    assert.ok(body.issues);
  }
});

test("snapshot responses distinguish persisted observations from bundled fallbacks", async () => {
  const { secSnapshotResponse } = await import("@/lib/dashboard/source-snapshots");
  const generatedAt = new Date().toISOString();
  const cache = { schemaVersion: 1 as const, generatedAt, source: "SEC EDGAR submissions API" as const, lookbackDays: 365, companies: [], errors: [], warnings: [], filings: [] };
  assert.equal(secSnapshotResponse(cache, "postgres").refresh.status, "fresh");
  assert.equal(secSnapshotResponse(cache, "postgres").refresh.source, "postgres");
  assert.equal(secSnapshotResponse(cache, "bundled").refresh.status, "stale");
});
