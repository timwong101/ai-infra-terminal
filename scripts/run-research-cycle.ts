import { runResearchCycle } from "@/lib/operations/research-cycle";

runResearchCycle(process.env.GITHUB_ACTIONS ? "github-actions" : "cli")
  .then((result) => console.log(`Research cycle ${result.id} completed.`))
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
