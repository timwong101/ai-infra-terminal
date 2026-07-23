import { classifyAlertCategory, classifyAlertImpact, classifyClaimImpact } from "@/lib/alerts/generate";

const MATERIAL_PATTERNS = [
  /\b(?:megawatt|gigawatt|mw|gw)\b/i,
  /\b(?:billion|million|financing|debt|convertible|credit facility)\b/i,
  /\b(?:contract|customer|backlog|capacity|data cent(?:er|re)|gpu|accelerator)\b/i,
  /\b(?:delay|cancel|default|outage|constraint|investigation)\b/i,
];

const TYPE_RULES: Array<[string, RegExp]> = [
  ["Capacity", /\bcapacity|data cent(?:er|re)|megawatt|gigawatt|\bmw\b|\bgw\b|campus|facility/i],
  ["Customers", /\bcustomer|contract|backlog|reservation|workload|demand/i],
  ["Financing", /\bfinancing|liquidity|debt|convertible|credit facility|capital raise|offering/i],
  ["Compute", /\bgpu|accelerator|compute|cluster|nvidia|amd\b/i],
  ["Power", /\bpower|grid|energiz|electricity|utility|substation/i],
  ["Execution", /\bdelay|construction|delivery|schedule|outage|constraint|permit/i],
  ["Results", /\bearnings|quarter|revenue|financial results|guidance|outlook/i],
  ["Partnership", /\bpartner|agreement|collaboration|joint venture/i],
];

export function classifyLiveEvent(value: string, sourceKind: "official-ir" | "gdelt", sourceScore = 50) {
  const eventType = TYPE_RULES.find(([, pattern]) => pattern.test(value))?.[0] ?? "Company update";
  const category = classifyAlertCategory(value);
  const classifiedImpact = classifyAlertImpact(value, "external_event");
  const alertImpact = classifiedImpact !== "watch"
    ? classifiedImpact
    : /\b(?:signed|secured|awarded|launched|expanded|opened|energized|completed|increased)\b/i.test(value)
      ? "strengthens"
      : /\b(?:cancelled|canceled|delayed|defaulted|impaired|reduced|suspended)\b/i.test(value)
        ? "weakens"
        : "watch";
  const materialMatches = MATERIAL_PATTERNS.filter((pattern) => pattern.test(value)).length;
  const materialityScore = Math.max(35, Math.min(98, 42 + materialMatches * 13 + (sourceKind === "official-ir" ? 12 : 0)));
  const credibilityScore = sourceKind === "official-ir"
    ? Math.max(80, Math.min(100, sourceScore))
    : Math.max(35, Math.min(78, sourceScore));
  const claimKind = category === "Capacity"
    ? "capacity-growth"
    : category === "Demand"
      ? "demand-growth"
      : category === "Funding"
        ? "funding-risk"
        : category === "Customer"
          ? "customer-risk"
          : category === "Execution"
            ? "execution-risk"
            : null;
  const riskClaim = claimKind === "funding-risk" || claimKind === "customer-risk" || claimKind === "execution-risk";
  const claimImpact = classifyClaimImpact(alertImpact, riskClaim);
  return {
    eventType,
    category,
    alertImpact,
    claimKind,
    claimImpact,
    materialityScore,
    credibilityScore,
  };
}

export function normalizeEventUrl(value: string) {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|gclid|fbclid|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch {
    return value.trim();
  }
}
