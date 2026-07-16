import { createResearchBriefing } from "@/lib/operations/briefing";

const hours = Math.max(1, Math.min(168, Number(process.argv[2]) || 24));
const until = new Date();

createResearchBriefing({ since: new Date(until.valueOf() - hours * 60 * 60 * 1_000), until })
  .then((briefing) => console.log(`Created ${briefing.title} with ${briefing.stats.newEvidence} new evidence passages.`))
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
