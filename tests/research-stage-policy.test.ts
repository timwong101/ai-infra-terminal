import assert from "node:assert/strict";
import test from "node:test";
import { assertIngestionSucceeded } from "@/lib/operations/stages";

test("ingestion stage rejects partial extraction failures with diagnostics", () => {
  assert.throws(
    () => assertIngestionSucceeded("SEC", { total: 3, failed: 1, failures: [{ message: "Parser rejected malformed HTML." }] }),
    /1 of 3.*malformed HTML/,
  );
});

test("ingestion stage accepts a clean batch", () => {
  assert.doesNotThrow(() => assertIngestionSucceeded("IR", { processed: 2, failed: 0, failures: [] }));
});
