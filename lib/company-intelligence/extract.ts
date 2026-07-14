import type { ExtractedMetric } from "@/lib/company-intelligence/types";

function sentenceAround(value: string, index: number) {
  const start = Math.max(value.lastIndexOf(". ", index - 1), value.lastIndexOf("? ", index - 1), value.lastIndexOf("! ", index - 1), value.lastIndexOf("\n", index - 1));
  const endings = [value.indexOf(". ", index), value.indexOf("? ", index), value.indexOf("! ", index), value.indexOf("\n", index)].filter((candidate) => candidate >= 0);
  const end = endings.length ? Math.min(...endings) + 1 : Math.min(value.length, index + 360);
  return value.slice(start < 0 ? 0 : start + 2, end).trim().replace(/\s+/g, " ");
}

function parseNumber(value: string) {
  return Number(value.replaceAll(",", ""));
}

function moneyInMillions(amount: string, scale = "") {
  const value = parseNumber(amount);
  if (/billion|bn|b\b/i.test(scale)) return value * 1_000;
  if (/million|m\b/i.test(scale)) return value;
  return value / 1_000_000;
}

function moneyDisplay(amount: string, scale = "") {
  const suffix = /billion|bn|b\b/i.test(scale) ? "B" : /million|m\b/i.test(scale) ? "M" : "";
  return `$${amount.replace(/\.0+$/, "")}${suffix}`;
}

type MoneyRule = { metricKey: string; label: string; category: string; context: RegExp; confidence: number };
const MONEY_RULES: MoneyRule[] = [
  { metricKey: "contract_value", label: "Contract value", category: "Customers & demand", context: /\bcontract(?:ed)?(?:\s+\w+){0,2}\s+(?:value|revenue)|customer commitment|capacity reservation/i, confidence: 84 },
  { metricKey: "backlog", label: "Backlog", category: "Customers & demand", context: /\bbacklog|remaining performance obligation/i, confidence: 92 },
  { metricKey: "revenue", label: "Revenue", category: "Revenue & demand", context: /\brevenue|sales\b/i, confidence: 91 },
  { metricKey: "capex", label: "Capital expenditure", category: "Capital intensity", context: /\bcapex|capital expenditure|capital spending/i, confidence: 90 },
  { metricKey: "liquidity", label: "Cash and liquidity", category: "Funding & liquidity", context: /\bliquidity|cash and cash equivalents|cash balance/i, confidence: 89 },
  { metricKey: "operating_cash_flow", label: "Operating cash flow", category: "Cash generation", context: /operating cash flow|cash flow from operations/i, confidence: 88 },
  { metricKey: "debt", label: "Debt and borrowings", category: "Funding & liquidity", context: /\bdebt|borrowings|convertible notes?|credit facility/i, confidence: 87 },
];

const MARKET_ESTIMATE_PATTERN = /hyperscalers? capex estimates?|amazon|alphabet|google|meta platforms|microsoft|market size|total addressable market|megaprojects|industry estimate/i;

export function extractMetricsFromText(value: string): ExtractedMetric[] {
  const metrics = new Map<string, ExtractedMetric>();
  const moneyPattern = /(?:US\s*)?\$\s*([\d,.]+)\s*(billion|million|bn|mm|m|b)?/gi;
  for (const match of value.matchAll(moneyPattern)) {
    const context = sentenceAround(value, match.index ?? 0);
    const nearbyStart = Math.max(0, (match.index ?? 0) - 90);
    const nearby = value.slice(nearbyStart, Math.min(value.length, (match.index ?? 0) + match[0].length + 90));
    const amountPosition = (match.index ?? 0) - nearbyStart;
    const amountEnd = amountPosition + match[0].length;
    const rule = MONEY_RULES.map((candidate) => {
      const labelMatch = nearby.match(candidate.context);
      const start = labelMatch?.index ?? -1;
      const end = start + (labelMatch?.[0].length ?? 0);
      const distance = start < 0 ? Number.POSITIVE_INFINITY : end <= amountPosition ? amountPosition - end : start >= amountEnd ? start - amountEnd : 0;
      return { candidate, distance };
    }).filter((candidate) => candidate.distance <= 45)
      .sort((left, right) => left.distance - right.distance)[0]?.candidate;
    if (!rule || metrics.has(rule.metricKey)) continue;
    if (["capex", "revenue"].includes(rule.metricKey) && MARKET_ESTIMATE_PATTERN.test(context)) continue;
    const normalizedValue = moneyInMillions(match[1], match[2] ?? "");
    if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) continue;
    metrics.set(rule.metricKey, { ...rule, normalizedValue, displayValue: moneyDisplay(match[1], match[2] ?? ""), unit: "USD millions", context });
  }

  const powerPattern = /([\d,.]+)\s*(GW|MW|gigawatts?|megawatts?)(?:\b|\s)/gi;
  for (const match of value.matchAll(powerPattern)) {
    const context = sentenceAround(value, match.index ?? 0);
    const nearby = value.slice(Math.max(0, (match.index ?? 0) - 60), Math.min(value.length, (match.index ?? 0) + match[0].length + 60));
    if (!/power|capacity|campus|data cent(?:er|re)|building|energized|grid/i.test(nearby)) continue;
    const raw = parseNumber(match[1]);
    const normalizedValue = /^g/i.test(match[2]) ? raw * 1_000 : raw;
    if (!Number.isFinite(normalizedValue) || normalizedValue <= 0) continue;
    const activePosition = nearby.search(/energized|\blive\b|active power|in service|operates?/i);
    const plannedPosition = nearby.search(/contracted|secured|guidance|pipeline|planned|under construction|development capacity|available power|expected|will be operational/i);
    const metricPosition = nearby.indexOf(match[0]);
    const isActive = activePosition >= 0 && Math.abs(activePosition - metricPosition) <= 70
      && (plannedPosition < 0 || Math.abs(activePosition - metricPosition) <= Math.abs(plannedPosition - metricPosition));
    const isPlanned = plannedPosition >= 0 && !isActive;
    const metricKey = isActive ? "active_power_capacity" : isPlanned ? "planned_power_capacity" : "power_capacity";
    const label = isActive ? "Active power capacity" : isPlanned ? "Planned or secured power" : "Reported power capacity";
    const current = metrics.get(metricKey);
    if (!current || normalizedValue > current.normalizedValue) metrics.set(metricKey, {
      metricKey, label, category: "Power & capacity", normalizedValue,
      displayValue: `${match[1]} ${/^g/i.test(match[2]) ? "GW" : "MW"}`, unit: "MW", context, confidence: 93,
    });
  }

  const gpuPatterns = [/([\d,]{3,})\s+(?:NVIDIA\s+|AMD\s+)?(?:GPUs?|accelerators?)/gi, /(?:GPUs?|accelerators?)\s+(?:of\s+|totaling\s+|approximately\s+)?([\d,]{3,})/gi];
  for (const pattern of gpuPatterns) for (const match of value.matchAll(pattern)) {
    const normalizedValue = parseNumber(match[1]);
    if (!Number.isFinite(normalizedValue) || normalizedValue < 100) continue;
    const context = sentenceAround(value, match.index ?? 0);
    const current = metrics.get("gpu_count");
    if (!current || normalizedValue > current.normalizedValue) metrics.set("gpu_count", {
      metricKey: "gpu_count", label: "Accelerator fleet", category: "Compute & accelerators", normalizedValue,
      displayValue: `${Math.round(normalizedValue).toLocaleString("en-US")} GPUs`, unit: "GPUs", context, confidence: 88,
    });
  }
  return [...metrics.values()];
}

export function compareMetricValues(current: number, previous?: number) {
  if (previous === undefined) return { direction: "new" as const, deltaPercent: null, significance: "medium" as const };
  const deltaPercent = previous === 0 ? null : Math.round((current - previous) / Math.abs(previous) * 100);
  if (deltaPercent === null) return { direction: current === previous ? "unchanged" as const : "changed" as const, deltaPercent, significance: "low" as const };
  const absolute = Math.abs(deltaPercent);
  return {
    direction: absolute <= 2 ? "unchanged" as const : deltaPercent > 0 ? "increased" as const : "decreased" as const,
    deltaPercent,
    significance: absolute >= 25 ? "high" as const : absolute >= 10 ? "medium" as const : "low" as const,
  };
}

const STRONG_LANGUAGE = /\b(achieved|accelerat|confiden|exceed|expanded|growth|increased|record|secured|strong)\b/gi;
const WEAK_LANGUAGE = /\b(adverse|constraint|declin|delay|depend|decreased|loss|pressure|risk|weaken)\b/gi;
const UNCERTAIN_LANGUAGE = /\b(could|may|might|uncertain|subject to|no assurance|cannot guarantee)\b/gi;

function countMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length;
}

export function compareDisclosureTone(current = "", previous = "") {
  const currentUncertainty = countMatches(current, UNCERTAIN_LANGUAGE);
  const previousUncertainty = countMatches(previous, UNCERTAIN_LANGUAGE);
  if (currentUncertainty > previousUncertainty) return "more uncertain" as const;
  const currentScore = countMatches(current, STRONG_LANGUAGE) - countMatches(current, WEAK_LANGUAGE);
  const previousScore = countMatches(previous, STRONG_LANGUAGE) - countMatches(previous, WEAK_LANGUAGE);
  if (currentScore > previousScore) return "stronger" as const;
  if (currentScore < previousScore) return "weaker" as const;
  return "neutral" as const;
}
