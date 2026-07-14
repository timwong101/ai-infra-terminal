import * as cheerio from "cheerio";
import type { IrSourceConfig } from "@/data/ir-sources";
import type { IrDocument, IrDocumentType } from "@/lib/ir/types";

const DATE_PATTERN = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+([0-9]{1,2}),\s+([0-9]{4})(?![0-9])/i;
const RELEVANCE_PATTERN = /\b(ai|artificial intelligence|cloud|data cent(?:er|re)|gpu|compute|capacity|power|megawatt|mw\b|financing|debt|revenue|backlog|contract|customer|earnings|results|guidance|capital expenditure|capex|infrastructure)\b/i;
const SKIP_TITLE_PATTERN = /^(read more|continue reading|download|pdf version|view|learn more|click here|webcast|email alerts?|subscribe|all news|view all)/i;
const REPORTING_PERIOD_PATTERN = /\bQ[1-4](?:\s*\/\s*FY)?\s+20[0-9]{2}\b/i;

function clean(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function isoDate(value: string) {
  const match = value.match(DATE_PATTERN);
  if (!match) return null;
  const parsed = new Date(`${match[1]} ${match[2]}, ${match[3]} 00:00:00 UTC`);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString().slice(0, 10);
}

function documentType(title: string, href: string): IrDocumentType {
  const value = `${title} ${href}`;
  if (/shareholder letter|letter to shareholders/i.test(value)) return "Shareholder Letter";
  if (/presentation|slides|investor update|outlook/i.test(value)) return "Presentation";
  if (/earnings|financial results|quarterly results|reports? .* results/i.test(value)) return "Earnings Release";
  return "Press Release";
}

function relevance(title: string, type: IrDocumentType) {
  let score = type === "Earnings Release" ? 85 : type === "Presentation" ? 78 : type === "Shareholder Letter" ? 80 : 55;
  const matches = title.match(new RegExp(RELEVANCE_PATTERN.source, "gi"))?.length ?? 0;
  score += Math.min(15, matches * 5);
  if (/conference|participate|date of|to release|webcast/i.test(title) && type === "Press Release") score -= 35;
  return Math.max(0, Math.min(100, score));
}

function stableKey(value: string) {
  return value.toLowerCase().replace(/\b(coreweave|nebius|applied digital|iren)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

export function normalizeIrPage(
  config: IrSourceConfig,
  sourcePageUrl: string,
  html: string,
  fetchedAt: string,
): IrDocument[] {
  if (/<rss[\s>]/i.test(html)) {
    const $xml = cheerio.load(html, { xmlMode: true });
    const rssDocuments: IrDocument[] = [];
    $xml("item").each((_, item) => {
      const title = clean($xml(item).find("title").first().text());
      const rawUrl = clean($xml(item).find("link").first().text());
      const published = new Date(clean($xml(item).find("pubDate").first().text()));
      if (!title || !rawUrl || Number.isNaN(published.valueOf())) return;
      let url: URL;
      try { url = new URL(rawUrl); } catch { return; }
      if (
        url.protocol !== "https:" ||
        !config.allowedHosts.includes(url.hostname) ||
        !config.includePathFragments.some((fragment) => url.pathname.includes(fragment))
      ) return;
      const type = documentType(title, url.pathname);
      const relevanceScore = relevance(title, type);
      if (relevanceScore < 40) return;
      const publishedAt = published.toISOString().slice(0, 10);
      const key = stableKey(title);
      rssDocuments.push({
        id: `ir:${config.companyId}:${publishedAt}:${key.slice(0, 80).replace(/\s+/g, "-")}`,
        companyId: config.companyId,
        companyName: config.companyName,
        ticker: config.ticker,
        documentType: type,
        publishedAt,
        title,
        summary: type === "Press Release" ? "Official company operating or strategic update" : `Official company ${type.toLowerCase()}`,
        sourceUrl: `${url.origin}${url.pathname}${url.search}`,
        sourcePageUrl,
        fetchedAt,
        sourceQuality: type === "Earnings Release" ? 90 : 82,
        relevanceScore,
        signal: "neutral",
      });
    });
    return rssDocuments.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  }

  const $ = cheerio.load(html);
  $("script, style, noscript, svg").remove();

  if (config.companyId === "nebius" && new URL(sourcePageUrl).pathname === "/financials") {
    const financialDocuments: IrDocument[] = [];
    $(".pc-attachment-card").each((_, element) => {
      const card = $(element);
      const cardText = clean(card.find("*").addBack().map((__, node) => (
        $(node).clone().children().remove().end().text()
      )).get().join(" "));
      const period = cardText.match(REPORTING_PERIOD_PATTERN)?.[0];
      const publishedAt = isoDate(cardText);
      if (!period || !publishedAt) return;

      card.find("a[href]").each((__, link) => {
        const label = clean($(link).text());
        const rawHref = $(link).attr("href");
        if (!rawHref || SKIP_TITLE_PATTERN.test(label)) return;
        let url: URL;
        try { url = new URL(rawHref, sourcePageUrl); } catch { return; }
        if (
          url.protocol !== "https:" ||
          !config.allowedHosts.includes(url.hostname) ||
          !config.includePathFragments.some((fragment) => url.pathname.includes(fragment))
        ) return;

        const title = `${config.companyName} ${period.toUpperCase()} ${label}`;
        const type = documentType(title, url.pathname);
        const relevanceScore = relevance(title, type);
        const key = stableKey(title);
        financialDocuments.push({
          id: `ir:${config.companyId}:${publishedAt}:${key.slice(0, 80).replace(/\s+/g, "-")}`,
          companyId: config.companyId,
          companyName: config.companyName,
          ticker: config.ticker,
          documentType: type,
          publishedAt,
          title,
          summary: `Official company ${type.toLowerCase()}`,
          sourceUrl: `${url.origin}${url.pathname}${url.search}`,
          sourcePageUrl,
          fetchedAt,
          sourceQuality: type === "Earnings Release" || type === "Shareholder Letter" ? 90 : 86,
          relevanceScore,
          signal: "neutral",
        });
      });
    });
    return financialDocuments.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
  }

  const candidates: IrDocument[] = [];

  $("a[href]").each((_, element) => {
    const anchor = $(element);
    const rawHref = anchor.attr("href");
    if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("mailto:") || rawHref.startsWith("javascript:")) return;

    let url: URL;
    try {
      url = new URL(rawHref, sourcePageUrl);
    } catch {
      return;
    }
    if (
      url.protocol !== "https:" ||
      !config.allowedHosts.includes(url.hostname) ||
      !config.includePathFragments.some((fragment) => url.pathname.includes(fragment)) ||
      /sec-filings/i.test(url.pathname)
    ) return;

    let container = anchor.parent();
    let context = clean(container.text());
    for (let depth = 0; depth < 5 && !DATE_PATTERN.test(context); depth += 1) {
      container = container.parent();
      const next = clean(container.text());
      if (next.length > 1_500) break;
      context = next;
    }
    const publishedAt = isoDate(context);
    if (!publishedAt) return;

    const anchorText = clean(anchor.text());
    const headingText = clean(container.find("h1, h2, h3, h4, h5, strong").first().text());
    const rawTitle = SKIP_TITLE_PATTERN.test(anchorText) || anchorText.length < 12 ? headingText : anchorText;
    const title = clean(rawTitle.replace(DATE_PATTERN, ""));
    if (title.length < 12 || title.length > 240 || SKIP_TITLE_PATTERN.test(title)) return;

    const type = documentType(title, url.pathname);
    const relevanceScore = relevance(title, type);
    if (relevanceScore < 40) return;
    const canonicalUrl = `${url.origin}${url.pathname}${url.search}`;
    const key = stableKey(title);
    candidates.push({
      id: `ir:${config.companyId}:${publishedAt}:${key.slice(0, 80).replace(/\s+/g, "-")}`,
      companyId: config.companyId,
      companyName: config.companyName,
      ticker: config.ticker,
      documentType: type,
      publishedAt,
      title,
      summary: type === "Press Release" ? "Official company operating or strategic update" : `Official company ${type.toLowerCase()}`,
      sourceUrl: canonicalUrl,
      sourcePageUrl,
      fetchedAt,
      sourceQuality: type === "Earnings Release" || type === "Shareholder Letter" ? 90 : type === "Presentation" ? 86 : 82,
      relevanceScore,
      signal: "neutral",
    });
  });

  $("*").each((_, element) => {
    const dateElement = $(element).clone().children().remove().end();
    const directText = clean(dateElement.text());
    const publishedAt = isoDate(directText);
    if (!publishedAt || directText.replace(DATE_PATTERN, "").trim().length > 20) return;

    let container = $(element).parent();
    for (let depth = 0; depth < 6; depth += 1) {
      const title = clean(container.find("h1, h2, h3, h4, h5").first().text()).replace(DATE_PATTERN, "").trim();
      if (title.length >= 12 && title.length <= 240) {
        const links = container.find("a[href]").toArray();
        for (const link of links) {
          const rawHref = $(link).attr("href");
          if (!rawHref) continue;
          let url: URL;
          try { url = new URL(rawHref, sourcePageUrl); } catch { continue; }
          if (
            url.protocol !== "https:" ||
            !config.allowedHosts.includes(url.hostname) ||
            !config.includePathFragments.some((fragment) => url.pathname.includes(fragment)) ||
            /sec-filings/i.test(url.pathname)
          ) continue;
          const type = documentType(title, url.pathname);
          const relevanceScore = relevance(title, type);
          if (relevanceScore < 40) break;
          const key = stableKey(title);
          candidates.push({
            id: `ir:${config.companyId}:${publishedAt}:${key.slice(0, 80).replace(/\s+/g, "-")}`,
            companyId: config.companyId,
            companyName: config.companyName,
            ticker: config.ticker,
            documentType: type,
            publishedAt,
            title,
            summary: type === "Press Release" ? "Official company operating or strategic update" : `Official company ${type.toLowerCase()}`,
            sourceUrl: `${url.origin}${url.pathname}${url.search}`,
            sourcePageUrl,
            fetchedAt,
            sourceQuality: type === "Earnings Release" || type === "Shareholder Letter" ? 90 : type === "Presentation" ? 86 : 82,
            relevanceScore,
            signal: "neutral",
          });
          break;
        }
        break;
      }
      container = container.parent();
      if (clean(container.text()).length > 1_500) break;
    }
  });

  return [...new Map(candidates.map((document) => [`${document.publishedAt}:${stableKey(document.title)}`, document])).values()]
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export function deduplicateIrDocuments(documents: IrDocument[]) {
  const titlesByUrl = new Map<string, Set<string>>();
  for (const document of documents) {
    const titles = titlesByUrl.get(document.sourceUrl) ?? new Set<string>();
    titles.add(stableKey(document.title));
    titlesByUrl.set(document.sourceUrl, titles);
  }

  const unambiguous = documents.filter((document) => (titlesByUrl.get(document.sourceUrl)?.size ?? 0) === 1);
  return [...new Map(unambiguous.map((document) => [`${document.companyId}:${document.publishedAt}:${stableKey(document.title)}`, document])).values()]
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}
