import { desc, eq } from "drizzle-orm";
import { getIssuerRegime, secCompanies } from "@/data/companies";
import { withDatabase } from "@/lib/db/client";
import { companies, filings, irSourceDocuments } from "@/lib/db/schema";
import type { EvidenceCache, SecEvidenceResponse } from "@/lib/evidence/types";
import type { IrDocument, IrEvidenceCache, IrEvidenceResponse } from "@/lib/ir/types";
import { secFormQuality, secFormSummary } from "@/lib/sec/normalize";

const FRESHNESS_WINDOW_MS = 12 * 60 * 60 * 1_000;

function refreshMetadata(observedAt: string, source: "postgres" | "bundled") {
  const ageMs = Math.max(0, Date.now() - new Date(observedAt).valueOf());
  const status = source === "postgres" && ageMs <= FRESHNESS_WINDOW_MS ? "fresh" : "stale";
  const hours = Math.max(0, Math.round(ageMs / 3_600_000));
  return {
    status,
    source,
    observedAt,
    message: source === "postgres"
      ? `Latest persisted source retrieval was ${hours < 1 ? "less than an hour" : `${hours}h`} ago.`
      : `Bundled fallback generated ${hours < 1 ? "less than an hour" : `${hours}h`} ago; database data is unavailable.`,
  } as const;
}

function primaryDocument(sourceUrl: string) {
  try { return new URL(sourceUrl).pathname.split("/").filter(Boolean).at(-1) ?? ""; }
  catch { return ""; }
}

export async function getPersistedSecSnapshot(): Promise<EvidenceCache | null> {
  const rows = await withDatabase((db) => db.select({ filing: filings, company: companies })
    .from(filings)
    .innerJoin(companies, eq(filings.companyId, companies.id))
    .orderBy(desc(filings.filedAt), desc(filings.retrievedAt)));
  if (!rows?.length) return null;
  const generatedAt = rows.reduce((latest, row) => row.filing.retrievedAt > latest ? row.filing.retrievedAt : latest, rows[0].filing.retrievedAt).toISOString();
  return {
    schemaVersion: 1,
    generatedAt,
    source: "SEC EDGAR submissions API",
    lookbackDays: 365,
    companies: [...new Set(rows.map((row) => row.company.id))],
    errors: [],
    warnings: [],
    filings: rows.map(({ filing, company }) => {
      const configuredCompany = secCompanies.find((item) => item.id === company.id);
      return {
      id: filing.id,
      companyId: company.id,
      companyName: company.name,
      ticker: company.ticker,
      cik: company.cik,
      theme: "Neoclouds",
      sourceType: "SEC",
      formType: filing.formType,
      filedAt: filing.filedAt,
      acceptedAt: null,
      periodOfReport: filing.periodOfReport,
      headline: `${company.name} filed ${filing.formType}`,
      summary: secFormSummary(filing.formType),
      accessionNumber: filing.accessionNumber,
      primaryDocument: primaryDocument(filing.sourceUrl),
      sourceUrl: filing.sourceUrl,
      fetchedAt: filing.retrievedAt.toISOString(),
      sourceQuality: secFormQuality(filing.formType),
      signal: "neutral",
      issuerClassification: configuredCompany ? getIssuerRegime(configuredCompany, filing.filedAt)?.classification ?? "domestic" : "domestic",
    };
    }),
  };
}

export async function getPersistedIrSnapshot(): Promise<IrEvidenceCache | null> {
  const rows = await withDatabase((db) => db.select({ document: irSourceDocuments, company: companies })
    .from(irSourceDocuments)
    .innerJoin(companies, eq(irSourceDocuments.companyId, companies.id))
    .orderBy(desc(irSourceDocuments.publishedAt), desc(irSourceDocuments.lastSeenAt)));
  if (!rows?.length) return null;
  const generatedAt = rows.reduce((latest, row) => row.document.lastSeenAt > latest ? row.document.lastSeenAt : latest, rows[0].document.lastSeenAt).toISOString();
  const documents: IrDocument[] = rows.map(({ document, company }) => ({
    id: document.id,
    companyId: company.id,
    companyName: company.name,
    ticker: company.ticker,
    documentType: document.documentType as IrDocument["documentType"],
    publishedAt: document.publishedAt,
    title: document.title,
    summary: document.summary,
    sourceUrl: document.sourceUrl,
    sourcePageUrl: document.sourcePageUrl,
    fetchedAt: document.lastSeenAt.toISOString(),
    sourceQuality: document.sourceQuality,
    relevanceScore: document.relevanceScore,
    signal: document.signal as IrDocument["signal"],
  }));
  return {
    schemaVersion: 1,
    generatedAt,
    source: "Official company investor-relations pages",
    companies: [...new Set(documents.map((item) => item.companyId))],
    errors: [],
    documents,
  };
}

export function secSnapshotResponse(cache: EvidenceCache, source: "postgres" | "bundled"): SecEvidenceResponse {
  return { cache, refresh: refreshMetadata(cache.generatedAt, source) };
}

export function irSnapshotResponse(cache: IrEvidenceCache, source: "postgres" | "bundled"): IrEvidenceResponse {
  return { cache, refresh: refreshMetadata(cache.generatedAt, source) };
}
