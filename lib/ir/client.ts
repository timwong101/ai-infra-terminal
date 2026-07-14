import type { IrSourceConfig } from "@/data/ir-sources";
import type { IrDocument } from "@/lib/ir/types";

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;
const PAGE_TIMEOUT_MS = 15_000;
const DOCUMENT_TIMEOUT_MS = 25_000;

export async function fetchIrPage(config: IrSourceConfig, pageUrl: string) {
  const url = new URL(pageUrl);
  if (url.protocol !== "https:" || !config.allowedHosts.includes(url.hostname)) throw new Error("IR page is outside the configured official domains.");
  const response = await fetch(url, {
    headers: { Accept: "text/html,application/xhtml+xml,application/rss+xml,application/xml", "User-Agent": "AI Infra Terminal IR research crawler" },
    signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`IR request failed: ${response.status} ${response.statusText}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BYTES) throw new Error("IR page is too large to process safely.");
  const html = await response.text();
  if (html.length > MAX_BYTES) throw new Error("IR page is too large to process safely.");
  return html;
}

export async function fetchIrDocumentContent(config: IrSourceConfig, document: IrDocument) {
  const url = new URL(document.sourceUrl);
  if (
    url.protocol !== "https:" ||
    !config.allowedHosts.includes(url.hostname) ||
    !config.includePathFragments.some((fragment) => url.pathname.includes(fragment))
  ) throw new Error("IR document is outside the configured official source paths.");

  const response = await fetch(url, {
    headers: {
      Accept: "application/pdf,text/html,application/xhtml+xml",
      "User-Agent": "AI Infra Terminal IR research crawler",
    },
    signal: AbortSignal.timeout(DOCUMENT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`IR document request failed: ${response.status} ${response.statusText}`);
  const contentLength = Number(response.headers.get("content-length") ?? 0);
  if (contentLength > MAX_DOCUMENT_BYTES) throw new Error("IR document is too large to process safely.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new Error("IR document is too large to process safely.");

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const isPdf = contentType.includes("application/pdf") || url.pathname.toLowerCase().endsWith(".pdf");
  return isPdf
    ? { kind: "pdf" as const, bytes }
    : { kind: "html" as const, html: new TextDecoder().decode(bytes) };
}
