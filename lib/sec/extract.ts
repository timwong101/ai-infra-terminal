import * as cheerio from "cheerio";
import type {
  EvidencePassage,
  FilingEvidenceSection,
  SecFilingDetail,
} from "@/lib/evidence/types";

type FilingMetadata = Pick<
  SecFilingDetail,
  | "filingId"
  | "companyId"
  | "companyName"
  | "ticker"
  | "formType"
  | "filedAt"
  | "accessionNumber"
  | "sourceUrl"
>;

type SectionRule = {
  category: string;
  title: string;
  pattern: RegExp;
  itemCode?: string;
};

const SECTION_RULES: SectionRule[] = [
  { category: "Risk", title: "Risk Factors", pattern: /^(?:item\s+1a[.\s:-]*)?risk factors?\.?$/i },
  { category: "Liquidity", title: "Liquidity and Capital Resources", pattern: /^(?:item\s+7[.\s:-]*)?liquidity and capital resources\.?$/i },
  { category: "Operations", title: "Management's Discussion and Analysis", pattern: /^(?:item\s+7[.\s:-]*)?management['’]s discussion and analysis/i },
  { category: "Operations", title: "Results of Operations", itemCode: "2.02", pattern: /^(?:item\s+2\.02[.\s:-]*)?results of operations/i },
  { category: "Business", title: "Business Overview", pattern: /^(?:item\s+1[.\s:-]*)?(?:our )?business(?: overview)?\.?$/i },
  { category: "Capacity", title: "Capital Expenditures", pattern: /^(?:capital expenditures|capital spending|data center capacity)\.?$/i },
  { category: "Demand", title: "Customers and Demand", pattern: /^(?:customers?|customer concentration|customers and demand)\.?$/i },
  { category: "Agreement", title: "Material Agreement", itemCode: "1.01", pattern: /^item\s+1\.01[.\s:-]*(?:entry into a )?material definitive agreement/i },
  { category: "Event", title: "Other Material Events", itemCode: "8.01", pattern: /^item\s+8\.01[.\s:-]*other events/i },
  { category: "Financials", title: "Financial Statements", itemCode: "9.01", pattern: /^item\s+9\.01[.\s:-]*financial statements/i },
];

const GENERIC_ITEM_PATTERN = /^item\s+([0-9]+(?:\.[0-9]+)?[a-z]?)[.\s:-]+(.{3,165})$/i;
const MAX_PASSAGE_LENGTH = 1_100;
const MAX_SECTIONS = 8;
const MAX_PASSAGES_PER_SECTION = 4;

function cleanText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[\t\r\f]+/g, " ")
    .replace(/\s*\n\s*/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();
}

function wordCount(value: string) {
  return value.split(/\s+/).filter(Boolean).length;
}

function isCoverPageBoilerplate(value: string) {
  return /check the appropriate box below|pre-commencement communications|securities registered pursuant|emerging growth company|indicate by check mark|exchange act \(17 cfr/i.test(value);
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
}

function findSectionHeading(value: string) {
  if (value.length > 180) return null;

  for (const rule of SECTION_RULES) {
    if (rule.pattern.test(value)) return { category: rule.category, title: rule.title, itemCode: rule.itemCode };
  }

  const item = value.match(GENERIC_ITEM_PATTERN);
  if (item) {
    return { category: "Filing item", title: `Item ${item[1]}: ${item[2].replace(/\.$/, "")}`, itemCode: item[1] };
  }
  return null;
}

function splitPassages(text: string): string[] {
  if (text.length <= MAX_PASSAGE_LENGTH) return [text];

  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
  const passages: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if (current && current.length + sentence.length + 1 > MAX_PASSAGE_LENGTH) {
      passages.push(current);
      current = "";
    }

    if (sentence.length > MAX_PASSAGE_LENGTH) {
      for (let offset = 0; offset < sentence.length; offset += MAX_PASSAGE_LENGTH) {
        const part = sentence.slice(offset, offset + MAX_PASSAGE_LENGTH).trim();
        if (part) passages.push(part);
      }
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) passages.push(current);
  return passages;
}

function extractBlocks(html: string) {
  const $ = cheerio.load(html);
  $(
    "script, style, noscript, svg, ix\\:header, ix\\:hidden, xbrli\\:context, xbrli\\:unit, " +
    "[style*='display:none'], [style*='display: none'], [hidden]",
  ).remove();

  const blocks: string[] = [];
  const seen = new Set<string>();
  const selector = "h1, h2, h3, h4, h5, h6, p, li, tr, div:not(:has(div, p, table, ul, ol))";

  $(selector).each((_, element) => {
    const text = cleanText($(element).text());
    if (text.length < 3 || seen.has(text)) return;
    seen.add(text);
    blocks.push(text);
  });

  const documentTitle = cleanText($("title").first().text()) || blocks.find((block) => block.length < 160) || "SEC filing";
  return { blocks, documentTitle };
}

function makePassages(sectionId: string, texts: string[]): EvidencePassage[] {
  const passages: EvidencePassage[] = [];
  const seen = new Set<string>();

  for (const text of texts) {
    for (const passageText of splitPassages(text)) {
      if (passageText.length < 90 || seen.has(passageText)) continue;
      seen.add(passageText);
      passages.push({
        id: `${sectionId}-passage-${passages.length + 1}`,
        text: passageText,
        wordCount: wordCount(passageText),
      });
      if (passages.length === MAX_PASSAGES_PER_SECTION) return passages;
    }
  }
  return passages;
}

export function extractSecFilingDetail(
  html: string,
  metadata: FilingMetadata,
  retrievedAt = new Date().toISOString(),
): SecFilingDetail {
  const { blocks, documentTitle: rawDocumentTitle } = extractBlocks(html);
  const rawSections: Array<{ title: string; category: string; itemCode?: string; texts: string[] }> = [];
  const overviewTexts: string[] = [];
  let activeSection: (typeof rawSections)[number] | null = null;

  for (const block of blocks) {
    const heading = findSectionHeading(block);
    if (heading) {
      activeSection = { ...heading, texts: [] };
      rawSections.push(activeSection);
      continue;
    }

    if (block.length < 90) continue;
    if (activeSection) activeSection.texts.push(block);
    else if (overviewTexts.length < MAX_PASSAGES_PER_SECTION && !isCoverPageBoilerplate(block)) overviewTexts.push(block);
  }

  if (overviewTexts.length > 0) {
    rawSections.unshift({ title: "Filing Overview", category: "Overview", texts: overviewTexts });
  }

  const merged = new Map<string, (typeof rawSections)[number]>();
  for (const section of rawSections) {
    const key = `${section.category}:${section.title}`;
    const existing = merged.get(key);
    if (existing) existing.texts.push(...section.texts);
    else merged.set(key, { ...section, texts: [...section.texts] });
  }

  const sections: FilingEvidenceSection[] = [];
  for (const section of merged.values()) {
    const id = `section-${slug(section.title) || sections.length + 1}`;
    const passages = makePassages(id, section.texts);
    if (passages.length === 0) continue;
    sections.push({ id, title: section.title, category: section.category, itemCode: section.itemCode, passages });
    if (sections.length === MAX_SECTIONS) break;
  }

  const allText = blocks.join(" ");
  const passageCount = sections.reduce((total, section) => total + section.passages.length, 0);
  const quality = sections.length >= 3 && passageCount >= 4
    ? "high"
    : passageCount >= 2
      ? "medium"
      : "limited";

  return {
    ...metadata,
    documentTitle: /[a-zA-Z]{3}/.test(rawDocumentTitle) && rawDocumentTitle.includes(" ")
      ? rawDocumentTitle
      : `${metadata.companyName} ${metadata.formType} filing`,
    retrievedAt,
    wordCount: wordCount(allText),
    sections,
    extraction: {
      method: "deterministic-html",
      quality,
      message: sections.length > 0
        ? `${passageCount} citation-ready passages extracted from ${sections.length} filing sections.`
        : "No reliable narrative sections were found in this filing document.",
    },
  };
}
