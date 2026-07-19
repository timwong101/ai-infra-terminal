import { secCompanies } from "@/data/companies";
import type { SecFilingDetail, SecFilingDetailResponse } from "@/lib/evidence/types";
import { compareFilings, getFilingComparisonMode } from "@/lib/evidence/compare";
import {
  getPersistedFilingDetail,
  persistFilingComparison,
  persistFilingDetail,
} from "@/lib/db/evidence-repository";
import { fetchSecDocument, validateSecUserAgent } from "@/lib/sec/client";
import { extractSecFilingDetail } from "@/lib/sec/extract";
import { buildSecArchiveUrl } from "@/lib/sec/normalize";
import { authorizeApi } from "@/lib/auth/session";

const DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const detailCache = new Map<string, { expiresAt: number; detail: SecFilingDetail }>();
const requestsInFlight = new Map<string, Promise<SecFilingDetail>>();

type FilingRequest = {
  cik: string;
  accessionNumber: string;
  primaryDocument: string;
  formType: string;
  filedAt: string;
};

function parseFilingRequest(request: Request, prefix = ""): FilingRequest | null {
  const params = new URL(request.url).searchParams;
  const cik = params.get(`${prefix}cik`) ?? "";
  const accessionNumber = params.get(`${prefix}accession`) ?? "";
  const primaryDocument = params.get(`${prefix}document`) ?? "";
  const formType = params.get(`${prefix}form`) ?? "";
  const filedAt = params.get(`${prefix}filedAt`) ?? "";

  if (prefix && !cik && !accessionNumber && !primaryDocument && !formType && !filedAt) return null;

  if (!/^\d{10}$/.test(cik)) throw new Error("Invalid filing CIK.");
  if (!/^\d{10}-\d{2}-\d{6}$/.test(accessionNumber)) throw new Error("Invalid accession number.");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.(?:html?|txt)$/i.test(primaryDocument)) throw new Error("Invalid primary document.");
  if (!/^[a-zA-Z0-9/-]{1,12}$/.test(formType)) throw new Error("Invalid filing form.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(filedAt)) throw new Error("Invalid filing date.");

  return { cik, accessionNumber, primaryDocument, formType, filedAt };
}

async function loadFilingDetail(filing: FilingRequest) {
  const company = secCompanies.find((candidate) => candidate.cik === filing.cik);
  if (!company || !company.forms.includes(filing.formType)) {
    throw new Error("This filing is not part of the configured SEC company universe.");
  }

  const cacheKey = `${filing.cik}:${filing.accessionNumber}:${filing.primaryDocument}`;
  const filingId = `sec:${filing.cik}:${filing.accessionNumber}`;

  try {
    const persisted = await getPersistedFilingDetail(filingId);
    if (persisted) return { detail: persisted, cacheStatus: "cached" as const, persisted: true };
  } catch {
    // Keep the research view usable if an optional database is temporarily unavailable.
  }

  const cached = detailCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { detail: cached.detail, cacheStatus: "cached" as const, persisted: false };
  }

  let inFlight = requestsInFlight.get(cacheKey);
  if (!inFlight) {
    const sourceUrl = buildSecArchiveUrl(filing.cik, filing.accessionNumber, filing.primaryDocument);
    const userAgent = validateSecUserAgent(process.env.SEC_USER_AGENT);
    inFlight = fetchSecDocument(sourceUrl, userAgent)
      .then((html) => extractSecFilingDetail(html, {
        filingId,
        companyId: company.id,
        companyName: company.name,
        ticker: company.ticker,
        formType: filing.formType,
        filedAt: filing.filedAt,
        periodOfReport: null,
        accessionNumber: filing.accessionNumber,
        sourceUrl,
      }))
      .then((detail) => {
        detailCache.set(cacheKey, { detail, expiresAt: Date.now() + DETAIL_CACHE_TTL_MS });
        return detail;
      })
      .finally(() => requestsInFlight.delete(cacheKey));
    requestsInFlight.set(cacheKey, inFlight);
  }

  const detail = await inFlight;
  let persisted = false;
  try {
    persisted = await persistFilingDetail(detail);
  } catch {
    persisted = false;
  }
  return { detail, cacheStatus: "fresh" as const, persisted };
}

export async function GET(request: Request) {
  const authorized = await authorizeApi(request);
  if ("response" in authorized) return authorized.response;
  try {
    const currentRequest = parseFilingRequest(request);
    if (!currentRequest) throw new Error("Invalid filing request.");
    const current = await loadFilingDetail(currentRequest);
    const mode = getFilingComparisonMode(current.detail.formType);
    const previousRequest = mode === "event" ? null : parseFilingRequest(request, "previous");
    const previous = previousRequest ? await loadFilingDetail(previousRequest) : null;
    const comparison = compareFilings(current.detail, previous?.detail ?? null);
    let comparisonPersisted = false;
    if (comparison && current.persisted && (!comparison.previousFiling || previous?.persisted)) {
      try {
        comparisonPersisted = await persistFilingComparison(comparison);
      } catch {
        comparisonPersisted = false;
      }
    }

    const result: SecFilingDetailResponse = {
      detail: current.detail,
      cacheStatus: current.cacheStatus,
      persistence: current.persisted && (!comparison || comparisonPersisted) ? "postgres" : "memory",
      comparison,
    };
    return Response.json(result, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to extract this SEC filing.";
    const invalidRequest = message.startsWith("Invalid") || message.includes("configured SEC company universe");
    return Response.json(
      { error: message },
      {
        status: invalidRequest ? 400 : 502,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
