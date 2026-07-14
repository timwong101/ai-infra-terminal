import type { EvidencePassage, FilingEvidenceSection } from "@/lib/evidence/types";

export type EventCategory = "Capacity" | "Funding" | "Demand" | "Customer" | "Execution" | "Other";

export type NormalizedSecEvent = {
  eventCode: string | null;
  eventType: string;
  category: EventCategory;
  relevanceScore: number;
  relevanceReason: string;
  eligible: boolean;
};

const ITEM_POLICIES: Record<string, { type: string; base: number; category?: EventCategory; administrative?: boolean }> = {
  "1.01": { type: "Material agreement", base: 35 },
  "1.02": { type: "Agreement termination", base: 35 },
  "2.02": { type: "Operating results", base: 45, category: "Demand" },
  "2.03": { type: "Financial obligation", base: 55, category: "Funding" },
  "2.04": { type: "Acceleration trigger", base: 60, category: "Funding" },
  "2.05": { type: "Exit or disposal plan", base: 35, category: "Execution" },
  "2.06": { type: "Material impairment", base: 45, category: "Execution" },
  "4.01": { type: "Auditor change", base: 5, administrative: true },
  "5.02": { type: "Leadership change", base: 10 },
  "5.07": { type: "Shareholder vote", base: 0, administrative: true },
  "7.01": { type: "Regulation FD update", base: 25 },
  "8.01": { type: "Other material event", base: 20 },
  "9.01": { type: "Exhibits and financial statements", base: 0, administrative: true },
};

const CATEGORY_SIGNALS: Array<{ category: EventCategory; weight: number; pattern: RegExp; label: string }> = [
  { category: "Capacity", weight: 25, pattern: /\b(data cent(?:er|re)|gpu|accelerator|megawatt|mw\b|power capacity|powered capacity|cluster|compute capacity|capital expenditure|capex)\b/i, label: "capacity" },
  { category: "Funding", weight: 25, pattern: /\b(credit facilit|financing|liquidity|debt|borrow|loan|lender|convertible note|revolving credit|interest rate|principal amount)\b/i, label: "funding" },
  { category: "Demand", weight: 20, pattern: /\b(revenue|backlog|contracted|workload|utilization|demand|reservation|purchase commitment|service agreement)\b/i, label: "demand" },
  { category: "Customer", weight: 20, pattern: /\b(customer|counterparty|concentration|tenant|offtake)\b/i, label: "customer" },
  { category: "Execution", weight: 20, pattern: /\b(construction|delivery|schedule|delay|permit|interconnect|energization|deployment|impairment|termination)\b/i, label: "execution" },
];

const BOILERPLATE_PATTERN = /\b(incorporated by reference into this item|shall not constitute an offer|schedules? to this agreement have been omitted|furnish supplementally|pursuant to item 601|signature(?:s)?\s*$)\b/i;
const EXHIBIT_LINE_PATTERN = /^\s*\d{1,3}(?:\.\d+)?\*{0,2}\s+.{0,80}(agreement|statement|certificate|press release)/i;

function inferItemCode(section: FilingEvidenceSection) {
  if (section.itemCode) return section.itemCode;
  const titleCode = section.title.match(/^item\s+([0-9]+(?:\.[0-9]+)?)/i)?.[1];
  if (titleCode) return titleCode;
  if (section.category === "Agreement") return "1.01";
  if (section.category === "Financials") return "9.01";
  if (section.category === "Event") return "8.01";
  return null;
}

export function normalizeSecEvent(
  formType: string,
  section: FilingEvidenceSection,
  passage: EvidencePassage,
): NormalizedSecEvent {
  const eventCode = inferItemCode(section);
  const policy = eventCode ? ITEM_POLICIES[eventCode] : undefined;
  const eventType = policy?.type ?? (formType.toUpperCase() === "6-K" ? "Foreign issuer update" : "Current report update");
  const boilerplate = BOILERPLATE_PATTERN.test(passage.text) || EXHIBIT_LINE_PATTERN.test(passage.text) || section.category === "Financials";

  const matches = CATEGORY_SIGNALS.filter((signal) => signal.pattern.test(passage.text));
  const scores = new Map<EventCategory, number>();
  for (const match of matches) scores.set(match.category, (scores.get(match.category) ?? 0) + match.weight);
  if (policy?.category) scores.set(policy.category, (scores.get(policy.category) ?? 0) + 12);

  const ranked = [...scores.entries()].sort((left, right) => right[1] - left[1]);
  const category = ranked[0]?.[0] ?? "Other";
  const signalScore = matches.reduce((total, signal) => total + signal.weight, 0);
  const formBase = formType.toUpperCase() === "6-K" ? 25 : 10;
  const relevanceScore = Math.min(100, (policy?.base ?? formBase) + signalScore);
  const eligible = !policy?.administrative && !boilerplate && category !== "Other" && relevanceScore >= 45;

  let relevanceReason: string;
  if (policy?.administrative) relevanceReason = `${eventType} is administrative and does not change an infrastructure thesis by itself.`;
  else if (boilerplate) relevanceReason = "Administrative, exhibit, or incorporation-by-reference language was excluded.";
  else if (matches.length === 0) relevanceReason = `${eventType} contains no direct neocloud operating or financing signal.`;
  else relevanceReason = `${eventType} contains ${matches.map((match) => match.label).join(", ")} evidence relevant to the ${category.toLowerCase()} thesis.`;

  return { eventCode, eventType, category, relevanceScore, relevanceReason, eligible };
}
