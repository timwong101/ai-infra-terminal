import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { EvidenceCache } from "@/lib/evidence/types";
import { validateSecUserAgent } from "@/lib/sec/client";
import { syncSecFilingEvidence } from "@/lib/sec/persist";
import { generateResearchAlerts } from "@/lib/alerts/generate";

const CACHE_PATH = resolve("data/generated/sec-evidence.json");

async function main() {
  if (!process.env.DATABASE_URL?.trim()) throw new Error("DATABASE_URL is required to backfill filing evidence.");
  const userAgent = validateSecUserAgent(process.env.SEC_USER_AGENT);
  const cache = JSON.parse(await readFile(CACHE_PATH, "utf8")) as EvidenceCache;
  const force = process.argv.includes("--force");
  const result = await syncSecFilingEvidence(cache, userAgent, {
    force,
    onProgress: ({ processed, total, filingId, status }) => {
      console.log(`[${processed}/${total}] ${status}: ${filingId}`);
    },
  });
  console.log(`${force ? "Refresh" : "Backfill"} complete: ${result.persisted} persisted, ${result.reused} reused, ${result.failed} failed.`);
  const alerts = await generateResearchAlerts();
  console.log(`Alert sync: ${alerts.alerts} alerts, ${alerts.evidence} claim links, ${alerts.claims} claims.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
