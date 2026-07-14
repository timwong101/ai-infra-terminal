import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { refreshIrEvidence } from "@/lib/ir/ingest";
import { syncIrCatalog } from "@/lib/ir/pipeline";
import type { IrEvidenceCache } from "@/lib/ir/types";

const OUTPUT_PATH = resolve("data/generated/ir-evidence.json");

async function readPreviousCache() {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, "utf8")) as IrEvidenceCache;
  } catch {
    return null;
  }
}

async function main() {
  const cache = await refreshIrEvidence({ previousCache: await readPreviousCache() });
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(temporaryPath, OUTPUT_PATH);
  const ingestion = await syncIrCatalog(cache);
  console.log(`Wrote ${cache.documents.length} IR documents to ${OUTPUT_PATH}.`);
  if (ingestion) console.log(`IR extraction queue: ${ingestion.completed} completed, ${ingestion.pending} pending, ${ingestion.failed} failed.`);
  if (cache.errors.length) console.warn(`${cache.errors.length} IR pages failed and retained cached company documents where available.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
