import assert from "node:assert/strict";
import test from "node:test";
import { decodeEvidenceCursor, encodeEvidenceCursor } from "@/lib/research/evidence-pagination";

test("evidence cursors round-trip without exposing query syntax", () => {
  const cursor = { quality: 87, date: "2026-07-18", id: "research:sec:passage:1" };
  const encoded = encodeEvidenceCursor(cursor);
  assert.doesNotMatch(encoded, /research|passage/);
  assert.deepEqual(decodeEvidenceCursor(encoded), cursor);
});

test("invalid evidence cursors are rejected", () => {
  assert.equal(decodeEvidenceCursor("not-a-cursor"), null);
});
