import { and, desc, eq, gte, sql } from "drizzle-orm";
import { irSources } from "@/data/ir-sources";
import { withDatabase } from "@/lib/db/client";
import {
  companies,
  eventClaimImpacts,
  irSourceDocuments,
  liveEvents,
  researchAlerts,
  researchClaims,
} from "@/lib/db/schema";
import { seedResearchClaims } from "@/lib/alerts/generate";
import { classifyLiveEvent, normalizeEventUrl } from "@/lib/events/classify";
import type { LiveEventCatalog, LiveEventItem, LiveEventSourceKind } from "@/lib/events/types";

type GdeltArticle = {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
};

type EventInput = {
  companyId: string;
  sourceKind: LiveEventSourceKind;
  sourceName: string;
  sourceDomain: string;
  title: string;
  summary: string;
  sourceUrl: string;
  publishedAt: Date;
  sourceScore: number;
  language?: string | null;
  sourceCountry?: string | null;
  raw?: Record<string, unknown>;
};

const GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc";
const GDELT_QUERY = '(CoreWeave OR Nebius OR "Applied Digital" OR IREN OR "Iris Energy") (AI OR GPU OR "data center" OR capacity OR financing)';
const COMPANY_ALIASES: Array<{ companyId: string; pattern: RegExp }> = [
  { companyId: "coreweave", pattern: /\bCoreWeave\b/i },
  { companyId: "nebius", pattern: /\bNebius\b/i },
  { companyId: "applied-digital", pattern: /\bApplied Digital\b/i },
  { companyId: "iren", pattern: /\bIREN\b|\bIris Energy\b/i },
];

async function sha256(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function parseGdeltDate(value?: string) {
  if (!value) return null;
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  if (!match) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.valueOf()) ? null : parsed;
  }
  return new Date(`${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}Z`);
}

async function upsertEvent(input: EventInput) {
  const sourceUrl = normalizeEventUrl(input.sourceUrl);
  const fingerprint = await sha256(`${input.companyId}|${input.sourceKind}|${sourceUrl.toLowerCase()}`);
  const classification = classifyLiveEvent(`${input.title} ${input.summary}`, input.sourceKind, input.sourceScore);
  const id = `event:${fingerprint.slice(0, 32)}`;
  return withDatabase(async (db) => {
    const event = (await db.insert(liveEvents).values({
      id,
      companyId: input.companyId,
      sourceKind: input.sourceKind,
      sourceName: input.sourceName,
      sourceDomain: input.sourceDomain,
      title: input.title.slice(0, 500),
      summary: input.summary.slice(0, 1_500),
      sourceUrl,
      publishedAt: input.publishedAt,
      eventType: classification.eventType,
      materialityScore: classification.materialityScore,
      credibilityScore: classification.credibilityScore,
      evidenceStatus: input.sourceKind === "official-ir" ? "official" : "discovery",
      language: input.language,
      sourceCountry: input.sourceCountry,
      fingerprint,
      raw: input.raw ?? {},
    }).onConflictDoUpdate({
      target: liveEvents.fingerprint,
      set: {
        title: input.title.slice(0, 500),
        summary: input.summary.slice(0, 1_500),
        eventType: classification.eventType,
        materialityScore: classification.materialityScore,
        credibilityScore: classification.credibilityScore,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      },
    }).returning())[0];
    if (!event) return null;

    if (classification.claimKind) {
      const claim = (await db.select().from(researchClaims).where(and(
        eq(researchClaims.companyId, input.companyId),
        eq(researchClaims.kind, classification.claimKind),
      )).limit(1))[0];
      if (claim) {
        const impactScore = classification.claimImpact === "supports"
          ? Math.max(2, Math.round(classification.materialityScore / 12))
          : classification.claimImpact === "weakens"
            ? -Math.max(2, Math.round(classification.materialityScore / 12))
            : 0;
        await db.insert(eventClaimImpacts).values({
          id: `event-impact:${event.id}:${claim.id}`,
          eventId: event.id,
          claimId: claim.id,
          impact: classification.claimImpact,
          impactScore,
          rationale: `${input.sourceKind === "official-ir" ? "Official issuer update" : "GDELT-discovered coverage"} maps to the ${classification.category.toLowerCase()} thesis category. Analyst confirmation is required before it becomes evidence.`,
        }).onConflictDoUpdate({
          target: [eventClaimImpacts.eventId, eventClaimImpacts.claimId],
          set: { impact: classification.claimImpact, impactScore, updatedAt: new Date() },
        });
      }
    }

    if (classification.materialityScore >= 68) {
      await db.insert(researchAlerts).values({
        id: `event-alert:${event.id}`,
        companyId: input.companyId,
        liveEventId: event.id,
        alertType: "external_event",
        category: classification.category,
        significance: classification.materialityScore >= 82 ? "high" : "medium",
        impact: classification.alertImpact,
        title: input.title.slice(0, 300),
        summary: input.sourceKind === "official-ir"
          ? input.summary.slice(0, 500)
          : `Discovery signal from ${input.sourceDomain}. Verify against an official source before using it as evidence.`,
      }).onConflictDoUpdate({
        target: researchAlerts.liveEventId,
        set: {
          category: classification.category,
          significance: classification.materialityScore >= 82 ? "high" : "medium",
          impact: classification.alertImpact,
          title: input.title.slice(0, 300),
          summary: input.sourceKind === "official-ir"
            ? input.summary.slice(0, 500)
            : `Discovery signal from ${input.sourceDomain}. Verify against an official source before using it as evidence.`,
          updatedAt: new Date(),
        },
      });
    }
    return event;
  });
}

async function syncOfficialEvents() {
  const rows = await withDatabase((db) => db.select().from(irSourceDocuments)
    .where(gte(irSourceDocuments.publishedAt, sql`CURRENT_DATE - INTERVAL '120 days'`))
    .orderBy(desc(irSourceDocuments.publishedAt)).limit(160));
  if (!rows) throw new Error("Postgres is required to synchronize official events.");
  let upserted = 0;
  for (const row of rows) {
    const hostname = new URL(row.sourceUrl).hostname;
    const event = await upsertEvent({
      companyId: row.companyId,
      sourceKind: "official-ir",
      sourceName: "Official investor relations",
      sourceDomain: hostname,
      title: row.title,
      summary: row.summary || row.title,
      sourceUrl: row.sourceUrl,
      publishedAt: new Date(`${row.publishedAt}T12:00:00Z`),
      sourceScore: row.sourceQuality,
      raw: { documentType: row.documentType, relevanceScore: row.relevanceScore },
    });
    if (event) upserted += 1;
  }
  return upserted;
}

async function fetchGdeltFeed() {
  const url = new URL(GDELT_ENDPOINT);
  url.searchParams.set("query", GDELT_QUERY);
  url.searchParams.set("mode", "artlist");
  url.searchParams.set("format", "json");
  url.searchParams.set("sort", "datedesc");
  url.searchParams.set("timespan", "14d");
  url.searchParams.set("maxrecords", "75");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { "User-Agent": "AI-Infra-Terminal/1.0" }, signal: AbortSignal.timeout(12_000) });
      if (response.status === 429 && attempt === 0) {
        const retrySeconds = Math.min(3, Math.max(1, Number(response.headers.get("retry-after")) || 2));
        await new Promise((resolve) => setTimeout(resolve, retrySeconds * 1_000));
        continue;
      }
      if (!response.ok) throw new Error(`GDELT returned ${response.status}`);
      const result = await response.json() as { articles?: GdeltArticle[] };
      return { articles: result.articles ?? [], error: null as string | null };
    } catch (error) {
      if (attempt === 1) return { articles: [] as GdeltArticle[], error: error instanceof Error ? error.message : "GDELT request failed" };
    }
  }
  return { articles: [] as GdeltArticle[], error: "GDELT request failed" };
}

async function syncGdeltEvents() {
  const result = await fetchGdeltFeed();
  let upserted = 0;
  for (const article of result.articles) {
    if (!article.url || !article.title) continue;
    const companyId = COMPANY_ALIASES.find((item) => item.pattern.test(article.title!))?.companyId;
    if (!companyId) continue;
    const publishedAt = parseGdeltDate(article.seendate);
    if (!publishedAt) continue;
    const domain = article.domain || new URL(article.url).hostname;
    const event = await upsertEvent({
      companyId,
      sourceKind: "gdelt",
      sourceName: "GDELT DOC 2.0",
      sourceDomain: domain,
      title: article.title,
      summary: article.title,
      sourceUrl: article.url,
      publishedAt,
      sourceScore: irSources.find((item) => item.companyId === companyId)?.allowedHosts.includes(domain) ? 78 : 55,
      language: article.language,
      sourceCountry: article.sourcecountry,
      raw: article as Record<string, unknown>,
    });
    if (event) upserted += 1;
  }
  return { upserted, errors: result.error ? [{ companyId: "all", error: result.error }] : [] };
}

export async function refreshLiveEvents() {
  await seedResearchClaims();
  const official = await syncOfficialEvents();
  const gdelt = await syncGdeltEvents();
  return { official, gdelt: gdelt.upserted, errors: gdelt.errors };
}

function eventRowToItem(row: {
  event: typeof liveEvents.$inferSelect;
  company: typeof companies.$inferSelect;
  impact: typeof eventClaimImpacts.$inferSelect | null;
  claim: typeof researchClaims.$inferSelect | null;
}): LiveEventItem {
  return {
    id: row.event.id,
    companyId: row.company.id,
    companyName: row.company.name,
    ticker: row.company.ticker,
    theme: row.event.theme,
    sourceKind: row.event.sourceKind as LiveEventItem["sourceKind"],
    sourceName: row.event.sourceName,
    sourceDomain: row.event.sourceDomain,
    title: row.event.title,
    summary: row.event.summary,
    sourceUrl: row.event.sourceUrl,
    publishedAt: row.event.publishedAt.toISOString(),
    eventType: row.event.eventType,
    materialityScore: row.event.materialityScore,
    credibilityScore: row.event.credibilityScore,
    evidenceStatus: row.event.evidenceStatus as LiveEventItem["evidenceStatus"],
    language: row.event.language,
    sourceCountry: row.event.sourceCountry,
    claimImpact: row.impact && row.claim ? {
      claimId: row.claim.id,
      claimTitle: row.claim.title,
      impact: row.impact.impact as "supports" | "weakens" | "watch",
      rationale: row.impact.rationale,
      status: row.impact.status as "proposed" | "accepted" | "rejected",
    } : null,
  };
}

export async function getLiveEventCatalog(filters: { companyId?: string; sourceKind?: LiveEventSourceKind; minimumMateriality?: number } = {}): Promise<LiveEventCatalog> {
  const result = await withDatabase(async (db) => {
    const clauses = [
      filters.companyId ? eq(liveEvents.companyId, filters.companyId) : undefined,
      filters.sourceKind ? eq(liveEvents.sourceKind, filters.sourceKind) : undefined,
      filters.minimumMateriality ? gte(liveEvents.materialityScore, filters.minimumMateriality) : undefined,
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    const rows = await db.select({ event: liveEvents, company: companies, impact: eventClaimImpacts, claim: researchClaims })
      .from(liveEvents)
      .innerJoin(companies, eq(liveEvents.companyId, companies.id))
      .leftJoin(eventClaimImpacts, eq(eventClaimImpacts.eventId, liveEvents.id))
      .leftJoin(researchClaims, eq(eventClaimImpacts.claimId, researchClaims.id))
      .where(clauses.length ? and(...clauses) : undefined)
      .orderBy(desc(liveEvents.publishedAt), desc(liveEvents.materialityScore))
      .limit(250);
    const items = rows.map(eventRowToItem);
    const companyRows = await db.select().from(companies);
    return {
      events: items,
      companies: companyRows.map((company) => ({ id: company.id, name: company.name, ticker: company.ticker, count: items.filter((item) => item.companyId === company.id).length })),
      summary: {
        total: items.length,
        official: items.filter((item) => item.evidenceStatus === "official").length,
        discovery: items.filter((item) => item.evidenceStatus === "discovery").length,
        highMateriality: items.filter((item) => item.materialityScore >= 82).length,
        lastPublishedAt: items[0]?.publishedAt ?? null,
      },
      refresh: {
        lastSeenAt: rows[0]?.event.lastSeenAt.toISOString() ?? null,
        sources: (["official-ir", "gdelt"] as LiveEventSourceKind[]).map((kind) => ({ kind, count: items.filter((item) => item.sourceKind === kind).length })),
      },
    };
  });
  if (!result) throw new Error("Live event intelligence requires Postgres.");
  return result;
}
