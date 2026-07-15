import * as cheerio from "cheerio";
import type { FilingEvidenceSection } from "@/lib/evidence/types";
import type { IrDocument, IrDocumentDetail } from "@/lib/ir/types";

type RawPassage = { text: string; pageNumber?: number };
type TopicRule = { category: string; pattern: RegExp };

const TOPIC_RULES: TopicRule[] = [
  { category: "Capacity", pattern: /\b(capacity|data cent(?:er|re)|gpu|accelerator|cluster|rack|megawatt|mw|gigawatt|gw)\b/i },
  { category: "Revenue", pattern: /\b(revenue|arr|annualized run-rate|gross profit|gross margin|adjusted ebitda|operating loss)\b/i },
  { category: "Capital spending", pattern: /\b(capex|capital expenditure|capital spending|property and equipment|infrastructure investment)\b/i },
  { category: "Power", pattern: /\b(power|electricity|grid|energy|energization|substation|renewable)\b/i },
  { category: "Customers", pattern: /\b(customer|contract|agreement|backlog|demand|hyperscaler|meta|microsoft)\b/i },
  { category: "Financing", pattern: /\b(financing|liquidity|cash balance|debt|convertible|credit facility|equity|atm program)\b/i },
  { category: "Guidance", pattern: /\b(guidance|outlook|we expect|we target|expected to|forecast for|by the end of|full-year target)\b/i },
  { category: "Risk", pattern: /\b(risk|uncertain|constraint|delay|shortage|concentration|competition|may adversely)\b/i },
];

const MAX_PASSAGE_LENGTH = 1_100;
const MAX_PASSAGES_PER_TOPIC = 5;

function cleanText(value: string) {
  return value.replace(/\u00a0/g, " ").replace(/[\t\r\f]+/g, " ").replace(/\s*\n\s*/g, " ").replace(/ {2,}/g, " ").trim();
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function isBoilerplatePassage(value: string) {
  return /forward-looking statements?|actual results .* differ materially|cautioned not to .* rely|copyright .* all rights reserved/i.test(value);
}

function splitPassages(text: string) {
  const normalized = cleanText(text);
  if (normalized.length < 90) return [];
  const sentences = normalized.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  const passages: string[] = [];
  let current = "";

  const flush = () => {
    if (current.length >= 90) passages.push(current);
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length > MAX_PASSAGE_LENGTH) {
      flush();
      for (let offset = 0; offset < sentence.length; offset += MAX_PASSAGE_LENGTH) {
        const part = sentence.slice(offset, offset + MAX_PASSAGE_LENGTH).trim();
        if (part.length >= 90) passages.push(part);
      }
      continue;
    }
    if (current && current.length + sentence.length + 1 > MAX_PASSAGE_LENGTH) flush();
    current = current ? `${current} ${sentence}` : sentence;
  }
  flush();
  return passages;
}

export function classifyIrPassage(text: string) {
  let best: { category: string; score: number } | null = null;
  for (const rule of TOPIC_RULES) {
    const matches = text.match(new RegExp(rule.pattern.source, "gi"))?.length ?? 0;
    if (matches > 0 && (!best || matches > best.score)) best = { category: rule.category, score: matches };
  }
  return best?.category ?? null;
}

function buildSections(rawPassages: RawPassage[]): FilingEvidenceSection[] {
  const byCategory = new Map<string, RawPassage[]>();
  const seen = new Set<string>();

  for (const passage of rawPassages) {
    const normalized = cleanText(passage.text);
    if (normalized.length < 90 || seen.has(normalized) || isBoilerplatePassage(normalized)) continue;
    const category = classifyIrPassage(normalized);
    if (!category) continue;
    const passages = byCategory.get(category) ?? [];
    if (passages.length >= MAX_PASSAGES_PER_TOPIC) continue;
    seen.add(normalized);
    passages.push({ ...passage, text: normalized });
    byCategory.set(category, passages);
  }

  return [...byCategory.entries()].map(([category, passages]) => {
    const pages = passages.flatMap((passage) => passage.pageNumber ? [passage.pageNumber] : []);
    const id = `ir-section-${slug(category)}`;
    return {
      id,
      title: `${category} evidence`,
      category,
      pageStart: pages.length ? Math.min(...pages) : undefined,
      pageEnd: pages.length ? Math.max(...pages) : undefined,
      passages: passages.map((passage, index) => ({
        id: `${id}-passage-${index + 1}`,
        text: passage.text,
        wordCount: wordCount(passage.text),
        pageNumber: passage.pageNumber,
      })),
    };
  });
}

function buildDetail(
  document: IrDocument,
  rawPassages: RawPassage[],
  method: IrDocumentDetail["extraction"]["method"],
  pageCount: number | null,
  retrievedAt: string,
): IrDocumentDetail {
  const sections = buildSections(rawPassages);
  const passageCount = sections.reduce((total, section) => total + section.passages.length, 0);
  const scannedText = rawPassages.map((passage) => passage.text).join(" ");
  const quality = passageCount >= 10 ? "high" : passageCount >= 4 ? "medium" : "limited";
  return {
    documentId: document.id,
    companyId: document.companyId,
    companyName: document.companyName,
    ticker: document.ticker,
    documentType: document.documentType,
    publishedAt: document.publishedAt,
    title: document.title,
    sourceUrl: document.sourceUrl,
    sourcePageUrl: document.sourcePageUrl,
    retrievedAt,
    wordCount: wordCount(scannedText),
    pageCount,
    sections,
    extraction: {
      method,
      quality,
      message: sections.length
        ? `${passageCount} citation-ready passages extracted across ${sections.length} research topics.`
        : "No passages matched the configured AI infrastructure research topics.",
    },
  };
}

export function extractIrHtmlDetail(html: string, document: IrDocument, retrievedAt = new Date().toISOString()) {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer").remove();
  const rawPassages: RawPassage[] = [];
  $("p, li, blockquote").each((_, element) => {
    const text = cleanText($(element).text());
    for (const passage of splitPassages(text)) rawPassages.push({ text: passage });
  });
  return buildDetail(document, rawPassages, "deterministic-html", null, retrievedAt);
}

export function buildCatalogOnlyIrDetail(document: IrDocument, retrievedAt = new Date().toISOString()): IrDocumentDetail {
  return {
    documentId: document.id,
    companyId: document.companyId,
    companyName: document.companyName,
    ticker: document.ticker,
    documentType: document.documentType,
    publishedAt: document.publishedAt,
    title: document.title,
    sourceUrl: document.sourceUrl,
    sourcePageUrl: document.sourcePageUrl,
    retrievedAt,
    wordCount: 0,
    pageCount: null,
    sections: [],
    extraction: {
      method: "deterministic-html",
      quality: "limited",
      message: "Official catalog metadata retained; the document host does not permit reliable automated extraction.",
    },
  };
}

export async function extractIrPdfDetail(bytes: Uint8Array, document: IrDocument, retrievedAt = new Date().toISOString()) {
  const { extractText } = await import("unpdf");
  const result = await extractText(bytes, { mergePages: false });
  const rawPassages: RawPassage[] = [];
  for (const [pageIndex, pageText] of result.text.entries()) {
    for (const passage of splitPassages(pageText)) rawPassages.push({ text: passage, pageNumber: pageIndex + 1 });
  }
  return buildDetail(document, rawPassages, "pdf-text", result.totalPages, retrievedAt);
}
