export type MetricPolicyInput = {
  metricKey: string;
  normalizedValue: number;
  context: string;
  measurementType: string;
  periodStart?: string | null;
  periodEnd: string;
  sourceKind: string;
  valueType?: string;
};

const FINANCIAL_KEYS = new Set(["revenue", "capex", "liquidity", "operating_cash_flow", "debt", "backlog", "contract_value"]);
const OFFERING_CONTEXT = /prospectus|offer and sale|securities|at-the-market|equity offering|convertible notes?|capitalization table|net proceeds/i;
const COMPONENT_CONTEXT = /(?:increase|decrease|reduced|improved|declined)(?:\s+in)?\s+revenue[^.]{0,45}\bby\b|attributable to|contributed \$/i;
const FACILITY_CONTEXT = /campus|site|building|data cent(?:er|re)|forge|facility/i;

export function metricPeriodType(input: Pick<MetricPolicyInput, "measurementType" | "periodStart" | "periodEnd">) {
  if (input.measurementType !== "duration" || !input.periodStart) return "instant";
  const days = Math.round((Date.parse(input.periodEnd) - Date.parse(input.periodStart)) / 86_400_000);
  if (days >= 300) return "annual";
  if (days >= 150) return "year-to-date";
  if (days >= 70) return "quarter";
  return "other-duration";
}

export function analyzeMetricObservation(input: MetricPolicyInput) {
  const flags: string[] = [];
  const financial = FINANCIAL_KEYS.has(input.metricKey);
  const scopeType = financial ? "consolidated" : FACILITY_CONTEXT.test(input.context) ? "facility" : "company";
  const scopeLabel = scopeType === "consolidated" ? "Consolidated" : scopeType === "facility" ? "Facility or campus" : "Company total";
  const periodType = metricPeriodType(input);

  if (input.metricKey === "revenue" && OFFERING_CONTEXT.test(input.context)) flags.push("financing_amount_misclassified");
  if (input.metricKey === "revenue" && COMPONENT_CONTEXT.test(input.context)) flags.push("component_not_total");
  if (["revenue", "capex"].includes(input.metricKey) && /market size|total addressable market|industry estimate|peer spending/i.test(input.context)) flags.push("market_estimate");
  if (input.metricKey.includes("power_capacity") && input.normalizedValue <= 5 && OFFERING_CONTEXT.test(input.context)) flags.push("financing_table_collision");
  if (input.metricKey === "power_capacity" && scopeType === "company"
    && !/total|aggregate|portfolio|fleet|active power|con-?\s*nected power|contracted power|contracted capacity|owned capacity|secur(?:ed|ing)|pipeline|guidance|target|we (?:have|ended|expect)|our /i.test(input.context)) {
    flags.push("scope_uncertain");
  }
  if (financial && input.sourceKind === "text" && /\bby\s+\$[\d,.]+/i.test(input.context)) flags.push("delta_not_period_total");

  return {
    scopeType,
    scopeLabel,
    periodType,
    anomalyFlags: [...new Set(flags)],
    anomalyScore: Math.min(100, flags.length * 35),
    canonicalEligible: flags.length === 0,
  };
}

export function metricCompatibilityKey(input: { metricKey: string; scopeType: string; periodType: string; valueType: string }) {
  return `${input.metricKey}:${input.scopeType}:${input.periodType}:${input.valueType}`;
}

export function metricSourceRank(sourceKind: string) {
  if (sourceKind === "xbrl") return 4;
  if (sourceKind === "sec") return 3;
  if (sourceKind === "ir") return 2;
  return 1;
}
