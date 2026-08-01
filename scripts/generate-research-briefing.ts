import { createResearchBriefing, createResearchBriefingsForAllWorkspaces } from "@/lib/operations/briefing";

const hours = Math.max(1, Math.min(168, Number(process.argv[2]) || 24));
const until = new Date();

const since = new Date(until.valueOf() - hours * 60 * 60 * 1_000);
const workspaceId = process.env.BRIEFING_WORKSPACE_ID?.trim();

(workspaceId ? createResearchBriefing({ workspaceId, since, until }).then((briefing) => [briefing]) : createResearchBriefingsForAllWorkspaces({ since, until }))
  .then((briefings) => console.log(`Created ${briefings.length} workspace briefing${briefings.length === 1 ? "" : "s"} with ${briefings.reduce((total, briefing) => total + briefing.stats.newEvidence, 0)} new evidence passages.`))
  .catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
