import { createHash } from "node:crypto";

export type CompanyFactObservation = {
  id: string;
  metricKey: string;
  label: string;
  category: string;
  normalizedValue: number;
  displayValue: string;
  unit: string;
  context: string;
  confidence: number;
  documentDate: string;
  periodStart: string | null;
  periodEnd: string;
  measurementType: "instant" | "duration";
  taxonomy: string;
  concept: string;
  accessionNumber: string;
  form: string;
  sourceUrl: string;
};

type FactUnit = {
  start?: string;
  end: string;
  val: number;
  accn: string;
  fy?: number;
  fp?: string;
  form: string;
  filed: string;
};

export type CompanyFactsPayload = {
  cik: number;
  facts?: Record<string, Record<string, {
    label?: string;
    units?: Record<string, FactUnit[]>;
  }>>;
};

type MetricDefinition = {
  metricKey: string;
  label: string;
  category: string;
  concepts: string[];
};

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { metricKey: "revenue", label: "Revenue", category: "Demand", concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "Revenue"] },
  { metricKey: "capex", label: "Capital expenditures", category: "Capital", concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PurchaseOfPropertyPlantAndEquipment"] },
  { metricKey: "liquidity", label: "Cash & equivalents", category: "Funding", concepts: ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"] },
  { metricKey: "operating_cash_flow", label: "Operating cash flow", category: "Capital", concepts: ["NetCashProvidedByUsedInOperatingActivities", "CashFlowsFromUsedInOperatingActivities"] },
  { metricKey: "debt", label: "Debt", category: "Funding", concepts: ["LongTermDebtAndFinanceLeaseObligationsCurrentAndNoncurrent", "LongTermDebtCurrent", "LongTermDebt", "Borrowings"] },
];

function formatUsdMillions(value: number) {
  const millions = value / 1_000_000;
  if (Math.abs(millions) >= 1_000) return `$${(millions / 1_000).toFixed(1)}B`;
  return `$${Math.round(millions).toLocaleString("en-US")}M`;
}

function filingIndexUrl(cik: number, accessionNumber: string) {
  const accessionPath = accessionNumber.replaceAll("-", "");
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${accessionPath}/${accessionNumber}-index.html`;
}

export function extractCompanyFactObservations(payload: CompanyFactsPayload): CompanyFactObservation[] {
  const observations = new Map<string, CompanyFactObservation>();
  const acceptedForms = new Set(["10-Q", "10-K", "20-F", "6-K"]);

  for (const [taxonomy, facts] of Object.entries(payload.facts ?? {})) {
    if (taxonomy !== "us-gaap" && taxonomy !== "ifrs-full") continue;
    for (const definition of METRIC_DEFINITIONS) {
      for (const concept of definition.concepts) {
        const fact = facts[concept];
        if (!fact) continue;
        for (const unit of fact.units?.USD ?? []) {
          if (!acceptedForms.has(unit.form) || !Number.isFinite(unit.val) || !unit.end || !unit.accn) continue;
          const identity = `${definition.metricKey}:${concept}:${unit.accn}:${unit.start ?? "instant"}:${unit.end}`;
          const previous = observations.get(identity);
          if (previous && previous.documentDate >= unit.filed) continue;
          const measurementType = unit.start ? "duration" : "instant";
          observations.set(identity, {
            id: `metric:xbrl:${createHash("sha256").update(identity).digest("hex").slice(0, 24)}`,
            metricKey: definition.metricKey,
            label: definition.label,
            category: definition.category,
            normalizedValue: unit.val / 1_000_000,
            displayValue: formatUsdMillions(unit.val),
            unit: "USD millions",
            context: `${fact.label ?? definition.label} reported for ${unit.end} in ${unit.form}.`,
            confidence: 98,
            documentDate: unit.filed,
            periodStart: unit.start ?? null,
            periodEnd: unit.end,
            measurementType,
            taxonomy,
            concept,
            accessionNumber: unit.accn,
            form: unit.form,
            sourceUrl: filingIndexUrl(payload.cik, unit.accn),
          });
        }
      }
    }
  }

  return [...observations.values()].sort((left, right) => right.periodEnd.localeCompare(left.periodEnd) || right.documentDate.localeCompare(left.documentDate));
}

export async function fetchCompanyFacts(cik: string, userAgent: string) {
  const paddedCik = cik.padStart(10, "0");
  const response = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${paddedCik}.json`, {
    headers: { Accept: "application/json", "Accept-Encoding": "gzip, deflate", "User-Agent": userAgent },
  });
  if (!response.ok) throw new Error(`SEC Company Facts request failed: ${response.status} ${response.statusText}`);
  return extractCompanyFactObservations(await response.json() as CompanyFactsPayload);
}
