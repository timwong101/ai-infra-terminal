export type PeriodKind = "quarter" | "annual" | "calendar-fallback";
export type PeriodBasis = "reported" | "inferred" | "calendar-fallback";

export type PeriodDocument = {
  companyId: string;
  sourceKind: string;
  sourceDocumentId: string;
  sourceType: string;
  documentTitle: string;
  sourceUrl: string;
  documentDate: string;
  periodOfReport?: string | null;
  content?: string;
  evidenceCount: number;
  extractionStatus?: string | null;
};

export type ResolvedDocumentPeriod = PeriodDocument & {
  periodKey: string;
  label: string;
  periodKind: PeriodKind;
  periodBasis: PeriodBasis;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  periodStart: string;
  periodEnd: string;
  resolutionMethod: "sec-period-of-report" | "explicit-document-label" | "matched-periodic-filing" | "publication-date";
  resolutionConfidence: number;
};

const QUARTERLY_FORM = /^SEC (?:10-Q|10-Q\/A)$/i;
const ANNUAL_FORM = /^SEC (?:10-K|10-K\/A|20-F|20-F\/A)$/i;
const QUARTER_PATTERN = /\bQ([1-4])\s*(?:\/\s*)?(?:FY\s*)?'?(\d{2,4})\b/i;
const WORD_QUARTER_PATTERN = /\b(first|second|third|fourth)\s+quarter(?:\s+of)?\s+(?:FY\s*)?'?(\d{2,4})\b/i;
const ANNUAL_PATTERN = /\b(?:full\s+year|FY)\s*'?(\d{2,4})\b/i;

function normalizeYear(value: string) {
  const year = Number(value);
  return year < 100 ? 2000 + year : year;
}

function isoDate(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function rangeEndingAt(value: string, months: number) {
  const end = new Date(`${value}T00:00:00Z`);
  const start = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - months + 1, 1));
  return { periodStart: start.toISOString().slice(0, 10), periodEnd: value };
}

function formatPeriodEnd(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${value}T00:00:00Z`));
}

export function calendarPeriodForDate(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const year = date.getUTCFullYear();
  const quarter = Math.floor(date.getUTCMonth() / 3) + 1;
  const startMonth = (quarter - 1) * 3;
  return {
    periodKey: `calendar:${year}-Q${quarter}`,
    label: `Calendar Q${quarter} ${year}`,
    calendarYear: year,
    calendarQuarter: quarter,
    periodStart: isoDate(year, startMonth, 1),
    periodEnd: isoDate(year, startMonth + 3, 0),
  };
}

function explicitLabel(document: PeriodDocument) {
  const text = `${document.documentTitle} ${document.content ?? ""}`.slice(0, 4_000);
  const compact = text.match(QUARTER_PATTERN);
  const words = text.match(WORD_QUARTER_PATTERN);
  if (compact || words) {
    const quarter = compact ? Number(compact[1]) : ["first", "second", "third", "fourth"].indexOf(words![1].toLowerCase()) + 1;
    const year = normalizeYear((compact ?? words)![2]);
    return { kind: "quarter" as const, fiscalQuarter: quarter, fiscalYear: year, label: `Q${quarter} FY${year}` };
  }
  const annual = text.match(ANNUAL_PATTERN);
  if (annual) {
    const year = normalizeYear(annual[1]);
    return { kind: "annual" as const, fiscalQuarter: null, fiscalYear: year, label: `FY${year}` };
  }
  return null;
}

function dayDistance(left: string, right: string) {
  return Math.abs(new Date(`${left}T00:00:00Z`).valueOf() - new Date(`${right}T00:00:00Z`).valueOf()) / 86_400_000;
}

function reportedPeriod(document: PeriodDocument): ResolvedDocumentPeriod | null {
  if (!document.periodOfReport || (!QUARTERLY_FORM.test(document.sourceType) && !ANNUAL_FORM.test(document.sourceType))) return null;
  const annual = ANNUAL_FORM.test(document.sourceType);
  const end = document.periodOfReport;
  const year = Number(end.slice(0, 4));
  return {
    ...document,
    periodKey: `${annual ? "annual" : "quarter"}:${end}`,
    label: `${annual ? "FY" : "Quarter"} ended ${formatPeriodEnd(end)}`,
    periodKind: annual ? "annual" : "quarter",
    periodBasis: "reported",
    fiscalYear: year,
    fiscalQuarter: null,
    ...rangeEndingAt(end, annual ? 12 : 3),
    resolutionMethod: "sec-period-of-report",
    resolutionConfidence: 100,
  };
}

export function resolveDocumentPeriods(documents: PeriodDocument[]): ResolvedDocumentPeriod[] {
  const anchors = documents.map(reportedPeriod).filter((item): item is ResolvedDocumentPeriod => Boolean(item));
  return documents.map((document) => {
    const reported = reportedPeriod(document);
    if (reported) return reported;

    const explicit = explicitLabel(document);
    const earningsDocument = /^(?:Earnings Release|Presentation|Shareholder Letter)$/i.test(document.sourceType);
    const periodicEvent = /^SEC (?:8-K|6-K)$/i.test(document.sourceType)
      && /results of operations|quarter ended|three months ended/i.test(document.content ?? "");
    const earningsLike = explicit || earningsDocument || periodicEvent;
    const nearbyAnchor = earningsLike ? anchors
      .filter((anchor) => anchor.companyId === document.companyId && (!explicit || anchor.periodKind === explicit.kind))
      .map((anchor) => ({ anchor, distance: dayDistance(anchor.documentDate, document.documentDate) }))
      .filter((candidate) => candidate.distance <= (explicit?.kind === "annual" ? 90 : 35))
      .sort((left, right) => left.distance - right.distance)[0]?.anchor : undefined;

    if (nearbyAnchor) {
      return {
        ...document,
        periodKey: nearbyAnchor.periodKey,
        label: explicit?.label ?? nearbyAnchor.label,
        periodKind: nearbyAnchor.periodKind,
        periodBasis: "inferred",
        fiscalYear: explicit?.fiscalYear ?? nearbyAnchor.fiscalYear,
        fiscalQuarter: explicit?.fiscalQuarter ?? nearbyAnchor.fiscalQuarter,
        periodStart: nearbyAnchor.periodStart,
        periodEnd: nearbyAnchor.periodEnd,
        resolutionMethod: "matched-periodic-filing",
        resolutionConfidence: explicit ? 95 : 82,
      };
    }

    if (explicit) {
      const calendar = calendarPeriodForDate(document.documentDate);
      return {
        ...document,
        periodKey: `fiscal:${explicit.fiscalYear}-${explicit.kind === "quarter" ? `Q${explicit.fiscalQuarter}` : "FY"}`,
        label: explicit.label,
        periodKind: explicit.kind,
        periodBasis: "inferred",
        fiscalYear: explicit.fiscalYear,
        fiscalQuarter: explicit.fiscalQuarter,
        periodStart: calendar.periodStart,
        periodEnd: calendar.periodEnd,
        resolutionMethod: "explicit-document-label",
        resolutionConfidence: 90,
      };
    }

    const calendar = calendarPeriodForDate(document.documentDate);
    return {
      ...document,
      ...calendar,
      periodKind: "calendar-fallback",
      periodBasis: "calendar-fallback",
      fiscalYear: null,
      fiscalQuarter: null,
      resolutionMethod: "publication-date",
      resolutionConfidence: 45,
    };
  });
}
