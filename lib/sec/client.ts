import type { SecCompany } from "@/data/companies";
import type { SecSubmissionsResponse } from "@/lib/sec/types";

const SEC_SUBMISSIONS_BASE_URL = "https://data.sec.gov/submissions";
const MAX_ATTEMPTS = 3;
const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function validateSecUserAgent(value: string | undefined): string {
  const userAgent = value?.trim();
  if (!userAgent || !/\S+@\S+\.\S+/.test(userAgent)) {
    throw new Error(
      'SEC_USER_AGENT is required and must include a contact email, for example: "AI Infra Terminal you@example.com".',
    );
  }
  return userAgent;
}

export async function fetchSecSubmissions(
  company: SecCompany,
  userAgent: string,
): Promise<SecSubmissionsResponse> {
  const url = `${SEC_SUBMISSIONS_BASE_URL}/CIK${company.cik}.json`;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip, deflate",
        "User-Agent": userAgent,
      },
    });

    if (response.ok) {
      return (await response.json()) as SecSubmissionsResponse;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`SEC request failed for ${company.name}: ${response.status} ${response.statusText}`);
    }

    await wait(attempt * 750);
  }

  throw new Error(`SEC request failed for ${company.name}.`);
}

export async function fetchSecDocument(sourceUrl: string, userAgent: string): Promise<string> {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" || url.hostname !== "www.sec.gov" || !url.pathname.startsWith("/Archives/edgar/data/")) {
    throw new Error("Only SEC EDGAR filing documents can be fetched.");
  }

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Encoding": "gzip, deflate",
        "User-Agent": userAgent,
      },
    });

    if (response.ok) {
      const contentLength = Number(response.headers.get("content-length") ?? 0);
      if (contentLength > MAX_DOCUMENT_BYTES) {
        throw new Error("The SEC filing document is too large to extract safely.");
      }

      const html = await response.text();
      if (html.length > MAX_DOCUMENT_BYTES) {
        throw new Error("The SEC filing document is too large to extract safely.");
      }
      return html;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_ATTEMPTS) {
      throw new Error(`SEC filing request failed: ${response.status} ${response.statusText}`);
    }

    await wait(attempt * 750);
  }

  throw new Error("SEC filing request failed.");
}
