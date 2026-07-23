import { desc, eq, inArray } from "drizzle-orm";
import secCacheJson from "@/data/generated/sec-evidence.json";
import irCacheJson from "@/data/generated/ir-evidence.json";
import { generateResearchAlerts } from "@/lib/alerts/generate";
import { withDatabase } from "@/lib/db/client";
import { getIrIngestionSummary } from "@/lib/db/ir-evidence-repository";
import { researchCycleEvents, researchCycleRuns } from "@/lib/db/schema";
import type { EvidenceCache } from "@/lib/evidence/types";
import { refreshIrEvidence } from "@/lib/ir/ingest";
import { processIrExtractionQueue, syncIrCatalog } from "@/lib/ir/pipeline";
import type { IrEvidenceCache } from "@/lib/ir/types";
import { syncResearchEvidence } from "@/lib/research/evidence";
import { backfillResearchEmbeddings } from "@/lib/research/search";
import { syncCompanyIntelligence } from "@/lib/company-intelligence/service";
import { refreshLiveEvents } from "@/lib/events/service";
import { validateSecUserAgent } from "@/lib/sec/client";
import { refreshSecEvidence } from "@/lib/sec/ingest";
import { syncSecFilingEvidence } from "@/lib/sec/persist";
import { getCompanyFlowCoverage } from "@/lib/operations/company-coverage";
import { createResearchBriefing, listResearchBriefings } from "@/lib/operations/briefing";

function summarizeStageResult(value: unknown) {
  if (Array.isArray(value)) return { records: value.length };
  if (!value || typeof value !== "object") return {};
  const summary: Record<string, string | number | boolean> = {};
  for (const [key, item] of Object.entries(value).slice(0, 10)) {
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

async function runStage<T>(runId: string, name: string, operation: () => Promise<T>) {
  const eventId = `cycle-event:${crypto.randomUUID()}`;
  const startedAt = new Date();
  await withDatabase(async (db) => {
    await db.update(researchCycleRuns).set({ stage: name }).where(eq(researchCycleRuns.id, runId));
    await db.insert(researchCycleEvents).values({ id: eventId, runId, stage: name });
  });
  try {
    const result = await operation();
    const durationMs = Date.now() - startedAt.valueOf();
    await withDatabase((db) => db.update(researchCycleEvents).set({ status: "completed", metrics: { durationMs, ...summarizeStageResult(result) }, completedAt: new Date() }).where(eq(researchCycleEvents.id, eventId)));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown stage error";
    await withDatabase((db) => db.update(researchCycleEvents).set({ status: "failed", message, metrics: { durationMs: Date.now() - startedAt.valueOf() }, completedAt: new Date() }).where(eq(researchCycleEvents.id, eventId)));
    throw error;
  }
}

export async function runResearchCycle(trigger = "manual") {
  const id = `cycle:${crypto.randomUUID()}`;
  const startedAt = new Date();
  const previousRun = await withDatabase(async (db) => {
    const rows = await db.select().from(researchCycleRuns).where(eq(researchCycleRuns.status, "completed")).orderBy(desc(researchCycleRuns.completedAt)).limit(1);
    return rows[0] ?? null;
  });
  await withDatabase((db) => db.insert(researchCycleRuns).values({ id, trigger, metrics: {} }));
  const metrics: Record<string, unknown> = {};
  try {
    const userAgent = validateSecUserAgent(process.env.SEC_USER_AGENT);
    const secCache = await runStage(id, "refreshing-sec", () => refreshSecEvidence({ userAgent, previousCache: secCacheJson as unknown as EvidenceCache }));
    metrics.secDiscovery = { filings: secCache.filings.length, errors: secCache.errors.length };
    metrics.sec = await runStage(id, "persisting-sec", () => syncSecFilingEvidence(secCache, userAgent, { requestDelayMs: 120 }));
    const irCache = await runStage(id, "refreshing-ir", () => refreshIrEvidence({ previousCache: irCacheJson as unknown as IrEvidenceCache }));
    metrics.irCatalog = await runStage(id, "cataloging-ir", () => syncIrCatalog(irCache));
    metrics.events = await runStage(id, "refreshing-events", () => refreshLiveEvents());
    metrics.irExtraction = await runStage(id, "extracting-ir", () => processIrExtractionQueue(5));
    metrics.evidence = await runStage(id, "syncing-evidence", () => syncResearchEvidence());
    metrics.companyIntelligence = await runStage(id, "updating-company-intelligence", () => syncCompanyIntelligence());
    metrics.embeddings = await runStage(id, "embedding-evidence", () => backfillResearchEmbeddings(30));
    metrics.alerts = await runStage(id, "updating-theses", () => generateResearchAlerts());
    const briefing = await runStage(id, "building-briefing", () => createResearchBriefing({
      runId: id,
      since: previousRun?.completedAt ?? new Date(startedAt.valueOf() - 24 * 60 * 60 * 1_000),
    }));
    metrics.briefing = briefing.stats;
    await withDatabase((db) => db.update(researchCycleRuns).set({ status: "completed", stage: "completed", metrics, completedAt: new Date() }).where(eq(researchCycleRuns.id, id)));
    return { id, status: "completed" as const, metrics, briefing };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown research-cycle error";
    await withDatabase((db) => db.update(researchCycleRuns).set({ status: "failed", error: message, metrics, completedAt: new Date() }).where(eq(researchCycleRuns.id, id)));
    throw error;
  }
}

export async function getResearchOperations() {
  const result = await withDatabase(async (db) => {
    const runs = await db.select().from(researchCycleRuns).orderBy(desc(researchCycleRuns.startedAt)).limit(20);
    const runIds = runs.map((run) => run.id);
    const events = runIds.length
      ? await db.select().from(researchCycleEvents).where(inArray(researchCycleEvents.runId, runIds)).orderBy(desc(researchCycleEvents.startedAt))
      : [];
    const briefings = await listResearchBriefings(12);
    return {
      runs: runs.map((run) => ({ ...run, startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null, createdAt: run.createdAt.toISOString() })),
      events: events.map((event) => ({ ...event, startedAt: event.startedAt.toISOString(), completedAt: event.completedAt?.toISOString() ?? null, createdAt: event.createdAt.toISOString() })),
      briefings,
      queue: await getIrIngestionSummary(),
      coverage: await getCompanyFlowCoverage(),
      schedule: { cadence: "Every 6 hours", cron: "17 */6 * * *", source: "GitHub Actions", nextAction: "Configure DATABASE_URL and SEC_USER_AGENT repository secrets" },
      aiEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
    };
  });
  if (!result) throw new Error("Research operations require a configured database.");
  return result;
}
