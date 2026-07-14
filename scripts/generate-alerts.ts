import { generateResearchAlerts } from "@/lib/alerts/generate";

generateResearchAlerts()
  .then((result) => console.log(`Generated ${result.alerts} alerts, linked ${result.evidence} claim evidence records, and updated ${result.claims} claims.`))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
