import { syncCompanyIntelligence } from "@/lib/company-intelligence/service";

syncCompanyIntelligence()
  .then((result) => console.log(`Company intelligence: ${result.periods} periods, ${result.metrics} metrics, ${result.metricComparisons} metric comparisons, ${result.disclosureComparisons} disclosure comparisons.`))
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
