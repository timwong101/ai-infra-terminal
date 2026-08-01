import secCacheJson from "@/data/generated/sec-evidence.json";
import irCacheJson from "@/data/generated/ir-evidence.json";
import { generateResearchAlerts } from "@/lib/alerts/generate";
import { syncCompanyIntelligence } from "@/lib/company-intelligence/service";
import type { EvidenceCache } from "@/lib/evidence/types";
import { refreshLiveEvents } from "@/lib/events/service";
import { refreshIrEvidence } from "@/lib/ir/ingest";
import { processIrExtractionQueue, syncIrCatalog } from "@/lib/ir/pipeline";
import type { IrEvidenceCache } from "@/lib/ir/types";
import { createResearchBriefingsForAllWorkspaces } from "@/lib/operations/briefing";
import type { ResearchStageJobData, ResearchStageName } from "@/lib/operations/types";
import { syncResearchEvidence } from "@/lib/research/evidence";
import { backfillResearchEmbeddings } from "@/lib/research/search";
import { validateSecUserAgent } from "@/lib/sec/client";
import { refreshSecEvidence } from "@/lib/sec/ingest";
import { syncSecFilingEvidence } from "@/lib/sec/persist";
import { verifyArtifactIntegrityBatch } from "@/lib/artifacts/service";

const simulatedFailures = new Set<string>();

function summarize(value: unknown) {
  if (Array.isArray(value)) return { records: value.length };
  if (!value || typeof value !== "object") return {};
  const summary: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value).slice(0, 12)) {
    if (Array.isArray(item)) summary[key] = item.length;
    else if (["string", "number", "boolean"].includes(typeof item)) summary[key] = item as string | number | boolean;
    else if (item && typeof item === "object") {
      for (const [nestedKey, nestedItem] of Object.entries(item).slice(0, 5)) {
        if (["string", "number", "boolean"].includes(typeof nestedItem)) summary[`${key}.${nestedKey}`] = nestedItem as string | number | boolean;
      }
    }
  }
  return summary;
}

async function executeLiveStage(stage: ResearchStageName, data: ResearchStageJobData) {
  switch (stage) {
    case "ingesting-sec": {
      const userAgent = validateSecUserAgent(process.env.SEC_USER_AGENT);
      const cache = await refreshSecEvidence({ userAgent, previousCache: secCacheJson as unknown as EvidenceCache });
      const persisted = await syncSecFilingEvidence(cache, userAgent, { requestDelayMs: 120 });
      return { discovered: cache.filings.length, discoveryErrors: cache.errors.length, ...summarize(persisted) };
    }
    case "ingesting-ir": {
      const cache = await refreshIrEvidence({ previousCache: irCacheJson as unknown as IrEvidenceCache });
      const catalog = await syncIrCatalog(cache);
      const extraction = await processIrExtractionQueue(5);
      return { documents: cache.documents.length, sourceErrors: cache.errors.length, ...summarize(catalog), ...summarize(extraction) };
    }
    case "refreshing-events": return summarize(await refreshLiveEvents());
    case "verifying-artifacts": return summarize(await verifyArtifactIntegrityBatch(Number(process.env.ARTIFACT_VERIFY_BATCH_SIZE) || 25));
    case "syncing-evidence": return summarize(await syncResearchEvidence());
    case "updating-company-intelligence": return summarize(await syncCompanyIntelligence());
    case "embedding-evidence": return summarize(await backfillResearchEmbeddings(30));
    case "updating-theses": return summarize(await generateResearchAlerts());
    case "building-briefing": {
      const briefings = await createResearchBriefingsForAllWorkspaces({ runId: data.runId, since: new Date(data.windowStartedAt) });
      return { briefings: briefings.length, newEvidence: briefings.reduce((total, briefing) => total + briefing.stats.newEvidence, 0) };
    }
  }
}

export async function executeResearchStage(stage: ResearchStageName, data: ResearchStageJobData) {
  if (process.env.E2E_TEST === "1" && stage !== "building-briefing") {
    const failureKey = `${data.runId}:${stage}`;
    if (process.env.E2E_FAIL_STAGE_ONCE === stage && !simulatedFailures.has(failureKey)) {
      simulatedFailures.add(failureKey);
      throw new Error(`Deterministic retry fixture for ${stage}.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 35));
    return { fixture: true, stage, records: 1 };
  }
  return executeLiveStage(stage, data);
}
