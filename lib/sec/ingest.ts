import { secCompanies, type SecCompany } from "@/data/companies";
import type { EvidenceCache, EvidenceEvent } from "@/lib/evidence/types";
import { fetchSecSubmissions } from "@/lib/sec/client";
import { findUnexpectedIssuerForms, normalizeSecSubmissions } from "@/lib/sec/normalize";
import type { SecSubmissionsResponse } from "@/lib/sec/types";

const LOOKBACK_DAYS = 365;
const MAX_FILINGS_PER_COMPANY = 15;

type FetchSubmissions = (
  company: SecCompany,
  userAgent: string,
) => Promise<SecSubmissionsResponse>;

type RefreshSecEvidenceOptions = {
  userAgent: string;
  previousCache: EvidenceCache | null;
  now?: Date;
  fetchSubmissions?: FetchSubmissions;
  requestDelayMs?: number;
};

function cutoffDate(now: Date) {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - LOOKBACK_DAYS);
  return cutoff.toISOString().slice(0, 10);
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function refreshSecEvidence({
  userAgent,
  previousCache,
  now = new Date(),
  fetchSubmissions = fetchSecSubmissions,
  requestDelayMs = 250,
}: RefreshSecEvidenceOptions): Promise<EvidenceCache> {
  const fetchedAt = now.toISOString();
  const cutoff = cutoffDate(now);
  const filings: EvidenceEvent[] = [];
  const errors: EvidenceCache["errors"] = [];
  const warnings: EvidenceCache["warnings"] = [];
  let successfulCompanies = 0;

  for (const [index, company] of secCompanies.entries()) {
    try {
      const submissions = await fetchSubmissions(company, userAgent);
      warnings.push(...findUnexpectedIssuerForms(company, submissions, cutoff));
      filings.push(
        ...normalizeSecSubmissions(company, submissions, fetchedAt, cutoff).slice(
          0,
          MAX_FILINGS_PER_COMPANY,
        ),
      );
      successfulCompanies += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown SEC ingestion error";
      errors.push({ companyId: company.id, message });
      filings.push(
        ...(previousCache?.filings
          .filter((filing) => filing.companyId === company.id)
          .slice(0, MAX_FILINGS_PER_COMPANY) ?? []),
      );
    }

    if (requestDelayMs > 0 && index < secCompanies.length - 1) {
      await wait(requestDelayMs);
    }
  }

  if (successfulCompanies === 0) {
    throw new Error("Every SEC request failed. The previous cache was left unchanged.");
  }

  const deduplicated = Array.from(new Map(filings.map((filing) => [filing.id, filing])).values())
    .sort((left, right) => right.filedAt.localeCompare(left.filedAt))
    .slice(0, 60);

  return {
    schemaVersion: 1,
    generatedAt: fetchedAt,
    source: "SEC EDGAR submissions API",
    lookbackDays: LOOKBACK_DAYS,
    companies: secCompanies.map((company) => company.id),
    errors,
    warnings,
    filings: deduplicated,
  };
}
