import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { syncCompanyIntelligence } from "@/lib/company-intelligence/service";
import { persistFilingPeriodOfReport } from "@/lib/db/evidence-repository";
import type { EvidenceCache } from "@/lib/evidence/types";

async function main() {
  const cache = JSON.parse(await readFile(resolve("data/generated/sec-evidence.json"), "utf8")) as EvidenceCache;
  for (const filing of cache.filings) await persistFilingPeriodOfReport(filing.id, filing.periodOfReport);
  const result = await syncCompanyIntelligence();
  console.log(`Company intelligence: ${result.periods} periods, ${result.packages} packages, ${result.documents} documents, ${result.metrics} metrics, ${result.metricComparisons} metric comparisons, ${result.disclosureComparisons} disclosure comparisons.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
