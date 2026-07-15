import { desc, eq } from "drizzle-orm";
import secCacheJson from "@/data/generated/sec-evidence.json";
import irCacheJson from "@/data/generated/ir-evidence.json";
import { generateResearchAlerts } from "@/lib/alerts/generate";
import { withDatabase } from "@/lib/db/client";
import { getIrIngestionSummary } from "@/lib/db/ir-evidence-repository";
import { researchCycleRuns } from "@/lib/db/schema";
import type { EvidenceCache } from "@/lib/evidence/types";
import { refreshIrEvidence } from "@/lib/ir/ingest";
import { processIrExtractionQueue, syncIrCatalog } from "@/lib/ir/pipeline";
import type { IrEvidenceCache } from "@/lib/ir/types";
import { syncResearchEvidence } from "@/lib/research/evidence";
import { backfillResearchEmbeddings } from "@/lib/research/search";
import { syncCompanyIntelligence } from "@/lib/company-intelligence/service";
import { validateSecUserAgent } from "@/lib/sec/client";
import { refreshSecEvidence } from "@/lib/sec/ingest";
import { syncSecFilingEvidence } from "@/lib/sec/persist";
import { getCompanyFlowCoverage } from "@/lib/operations/company-coverage";

export async function runResearchCycle(trigger = "manual") {
  const id = `cycle:${crypto.randomUUID()}`;
  await withDatabase((db) => db.insert(researchCycleRuns).values({ id, trigger, metrics: {} }));
  const metrics: Record<string, unknown> = {};
  const stage = (name: string) => withDatabase((db) => db.update(researchCycleRuns).set({ stage: name, metrics }).where(eq(researchCycleRuns.id, id)));
  try {
    const userAgent = validateSecUserAgent(process.env.SEC_USER_AGENT);
    await stage("refreshing-sec");
    const secCache = await refreshSecEvidence({ userAgent, previousCache: secCacheJson as unknown as EvidenceCache });
    metrics.secDiscovery = { filings: secCache.filings.length, errors: secCache.errors.length };
    await stage("persisting-sec");
    metrics.sec = await syncSecFilingEvidence(secCache, userAgent, { requestDelayMs: 120 });
    await stage("refreshing-ir");
    const irCache = await refreshIrEvidence({ previousCache: irCacheJson as unknown as IrEvidenceCache });
    metrics.irCatalog = await syncIrCatalog(irCache);
    await stage("extracting-ir");
    metrics.irExtraction = await processIrExtractionQueue(5);
    await stage("syncing-evidence");
    metrics.evidence = await syncResearchEvidence();
    await stage("updating-company-intelligence");
    metrics.companyIntelligence = await syncCompanyIntelligence();
    await stage("embedding-evidence");
    metrics.embeddings = await backfillResearchEmbeddings(30);
    await stage("updating-theses");
    metrics.alerts = await generateResearchAlerts();
    await withDatabase((db) => db.update(researchCycleRuns).set({ status: "completed", stage: "completed", metrics, completedAt: new Date() }).where(eq(researchCycleRuns.id, id)));
    return { id, status: "completed" as const, metrics };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown research-cycle error";
    await withDatabase((db) => db.update(researchCycleRuns).set({ status: "failed", error: message, metrics, completedAt: new Date() }).where(eq(researchCycleRuns.id, id)));
    throw error;
  }
}

export async function getResearchOperations() {
  const result = await withDatabase(async (db) => {
    const runs = await db.select().from(researchCycleRuns).orderBy(desc(researchCycleRuns.startedAt)).limit(20);
    return {
      runs: runs.map((run) => ({ ...run, startedAt: run.startedAt.toISOString(), completedAt: run.completedAt?.toISOString() ?? null, createdAt: run.createdAt.toISOString() })),
      queue: await getIrIngestionSummary(),
      coverage: await getCompanyFlowCoverage(),
      schedule: "Every 6 hours via GitHub Actions or an authenticated cron request",
      aiEnabled: Boolean(process.env.OPENAI_API_KEY?.trim()),
    };
  });
  if (!result) throw new Error("Research operations require a configured database.");
  return result;
}
