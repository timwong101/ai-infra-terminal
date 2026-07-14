import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { EvidenceCache } from "@/lib/evidence/types";
import { validateSecUserAgent } from "@/lib/sec/client";
import { refreshSecEvidence } from "@/lib/sec/ingest";
import { syncSecFilingEvidence } from "@/lib/sec/persist";
import { generateResearchAlerts } from "@/lib/alerts/generate";

const OUTPUT_PATH = resolve("data/generated/sec-evidence.json");

async function readPreviousCache(): Promise<EvidenceCache | null> {
  try {
    return JSON.parse(await readFile(OUTPUT_PATH, "utf8")) as EvidenceCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: EvidenceCache) {
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  const temporaryPath = `${OUTPUT_PATH}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(cache, null, 2)}\n`, "utf8");
  await rename(temporaryPath, OUTPUT_PATH);
}

async function main() {
  const userAgent = validateSecUserAgent(process.env.SEC_USER_AGENT);
  const previousCache = await readPreviousCache();
  const cache = await refreshSecEvidence({ userAgent, previousCache });

  await writeCache(cache);
  console.log(`Wrote ${cache.filings.length} SEC filings to ${OUTPUT_PATH}.`);
  if (cache.errors.length > 0) {
    console.warn(`${cache.errors.length} company refreshes failed; prior cached records were retained.`);
  }
  if (process.env.DATABASE_URL?.trim()) {
    const result = await syncSecFilingEvidence(cache, userAgent);
    console.log(`Evidence sync: ${result.persisted} persisted, ${result.reused} reused, ${result.failed} failed.`);
    const alerts = await generateResearchAlerts();
    console.log(`Alert sync: ${alerts.alerts} alerts, ${alerts.evidence} claim links, ${alerts.claims} claims.`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
