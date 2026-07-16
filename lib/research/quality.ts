export type SuggestedClaimKind = "capacity-growth" | "demand-growth" | "funding-risk" | "customer-risk" | "execution-risk";
export type SuggestedClaimImpact = "supports" | "weakens" | "watch";

export type EvidenceQualityAssessment = {
  evidenceQualityScore: number;
  materialityScore: number;
  specificityScore: number;
  relevanceScore: number;
  boilerplateRisk: number;
  qualityReasons: string[];
  duplicateGroupId: string;
  suggestion: null | {
    claimKind: SuggestedClaimKind;
    impact: SuggestedClaimImpact;
    confidence: number;
    rationale: string;
  };
};

const MATERIAL_PATTERN = /\b(agreement|annual recurring revenue|arr|backlog|capacity|capital expenditure|capex|contract|customer|debt|financ|gpu|guidance|lease|liquidity|megawatt|mw\b|gigawatt|gw\b|notes?|power|revenue|utilization)\b/gi;
const INFRA_PATTERN = /\b(ai cloud|artificial intelligence|accelerator|blackwell|capacity|cluster|compute|data cent(?:er|re)|gpu|hpc|inference|megawatt|mw\b|gigawatt|gw\b|nvidia|power|rack|training workload)\b/gi;
const SPECIFIC_PATTERN = /(?:\$|€|£)\s?\d|\b\d+(?:\.\d+)?\s?(?:%|billion|million|thousand|mw|gw|gpu|years?|months?|customers?|buildings?)\b/gi;
const BOILERPLATE_PATTERNS: Array<[RegExp, number, string]> = [
  [/pursuant to the requirements of the securities exchange act|duly caused this report to be signed/i, 100, "signature or filing boilerplate"],
  [/shall not constitute an offer to sell|exemption from registration|incorporated (?:herein )?by reference/i, 95, "securities-law boilerplate"],
  [/contains ["“”]?forward-looking statements|words such as ["“].*anticipate/i, 92, "forward-looking-statement disclaimer"],
  [/^\s*\d{1,3}(?:\.\d+)?\W+(?:agreement|indenture|form of|certificates?|exhibit)/i, 92, "exhibit index entry"],
  [/\bcopy of .* (?:filed|attached) as .*exhibit|furnished herewith as exhibit/i, 90, "exhibit attachment notice"],
  [/management statements on non-gaap measures|should not consider .* as a substitute/i, 78, "standard non-GAAP disclaimer"],
  [/prior to joining .* held senior leadership|is responsible for investor engagement/i, 72, "management biography"],
  [/^the following table (?:sets forth|summarizes)/i, 60, "table introduction without the underlying values"],
];

const CLAIM_PATTERNS: Array<{ kind: SuggestedClaimKind; label: string; pattern: RegExp }> = [
  { kind: "capacity-growth", label: "capacity expansion", pattern: /\b(capacity|data cent(?:er|re)|energiz|gpu|hpc|megawatt|mw\b|gigawatt|gw\b|power|rack|site|campus|cluster)\b/gi },
  { kind: "demand-growth", label: "AI demand growth", pattern: /\b(ai cloud|artificial intelligence|arr|backlog|contracted|customer demand|inference|lease revenue|managed services|revenue|take-or-pay|training workload)\b/gi },
  { kind: "funding-risk", label: "funding and liquidity risk", pattern: /\b(borrow|capital|convertible|credit|debt|financ|interest|liquidity|notes?|preferred|principal|revolving)\b/gi },
  { kind: "customer-risk", label: "customer concentration risk", pattern: /\b(concentrat|contract durability|counterparty|customer|hyperscaler|lease|renewal|take-or-pay|tenant)\b/gi },
  { kind: "execution-risk", label: "execution risk", pattern: /\b(construction|delay|deliver|deploy|energiz|execution|on schedule|operat|permitting|supply|timeline|utilization)\b/gi },
];

const POSITIVE_PATTERN = /\b(awarded|backlog|completed|contracted|delivered|expanded|growth|increase|increased|launched|secured|signed|sufficient)\b/i;
const NEGATIVE_PATTERN = /\b(adverse|concentration|constraint|debt|decrease|decreased|delay|dependent|impair|loss|risk|shortfall|uncertain)\b/i;

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function matchCount(value: string, pattern: RegExp) {
  return new Set((value.match(pattern) ?? []).map((match) => match.toLowerCase())).size;
}

function stableHash(value: string) {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16);
}

export function evidenceDuplicateGroup(value: string) {
  const normalized = value.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9$% ]/g, "").trim();
  return `duplicate:${stableHash(normalized)}:${normalized.length}`;
}

function suggestionFor(value: string, quality: number, relevance: number, boilerplateRisk: number) {
  if (boilerplateRisk >= 60 || quality < 45 || relevance < 30) return null;
  const scores = CLAIM_PATTERNS.map((claim) => ({ ...claim, score: matchCount(value, claim.pattern) }));
  scores.sort((left, right) => right.score - left.score);
  const top = scores[0];
  const margin = top.score - (scores[1]?.score ?? 0);
  if (!top || top.score < 1) return null;

  const isMiningOnly = /\b(bitcoin|mining|hashrate|eh\/s)\b/i.test(value) && matchCount(value, INFRA_PATTERN) === 0;
  if (isMiningOnly && ["demand-growth", "customer-risk"].includes(top.kind)) return null;
  const riskClaim = ["funding-risk", "customer-risk", "execution-risk"].includes(top.kind);
  const positive = POSITIVE_PATTERN.test(value);
  const negative = NEGATIVE_PATTERN.test(value);
  const impact: SuggestedClaimImpact = riskClaim
    ? negative && !positive ? "supports" : positive && !negative ? "weakens" : "watch"
    : positive && !negative ? "supports" : negative && !positive ? "weakens" : "watch";
  const confidence = clamp(34 + top.score * 8 + margin * 5 + quality * .18 + relevance * .12 - boilerplateRisk * .2);
  return {
    claimKind: top.kind,
    impact,
    confidence,
    rationale: `${top.score} ${top.label} signal${top.score === 1 ? "" : "s"}; ${impact === "watch" ? "direction requires analyst judgment" : `${impact} is suggested from the passage's directional language`}.`,
  };
}

export function assessEvidenceQuality(input: { excerpt: string; topic: string; sectionTitle: string; sourceType: string; sourceQuality: number }): EvidenceQualityAssessment {
  const value = `${input.topic} ${input.sectionTitle} ${input.excerpt}`;
  const wordCount = input.excerpt.trim().split(/\s+/).filter(Boolean).length;
  const miningOnly = /\b(bitcoin|mining|hashrate|eh\/s)\b/i.test(input.excerpt) && !/\b(ai cloud|artificial intelligence|data cent(?:er|re)|gpu|hpc|inference|training workload)\b/i.test(input.excerpt);
  const materialSignals = matchCount(value, MATERIAL_PATTERN);
  const infraSignals = matchCount(value, INFRA_PATTERN);
  const specificSignals = matchCount(value, SPECIFIC_PATTERN);
  const boilerplate = BOILERPLATE_PATTERNS.find(([pattern]) => pattern.test(input.excerpt));
  const boilerplateRisk = boilerplate?.[1] ?? (/\bmay|could|might\b/gi.test(input.excerpt) && specificSignals === 0 ? 22 : 5);
  const materialityScore = clamp(20 + materialSignals * 11 + specificSignals * 7 + (/contract|guidance|liquidity|capacity|revenue/i.test(input.topic) ? 8 : 0));
  const specificityScore = clamp(16 + specificSignals * 16 + (wordCount >= 35 ? 12 : 0) + (wordCount >= 80 ? 8 : 0));
  const relevanceScore = miningOnly ? 15 : clamp(12 + infraSignals * 14 + (/Power & capacity|Compute & accelerators|Customers & demand/i.test(input.topic) ? 12 : 0));
  const calculatedQuality = clamp(input.sourceQuality * .2 + materialityScore * .3 + specificityScore * .18 + relevanceScore * .32 - boilerplateRisk * .38);
  const evidenceQualityScore = miningOnly ? Math.min(42, calculatedQuality) : calculatedQuality;
  const qualityReasons = [
    materialSignals >= 3 ? "Material operating or financial signals" : materialSignals ? "Some material context" : "Few material signals",
    specificSignals >= 2 ? "Contains specific quantities or terms" : "Limited quantitative specificity",
    miningOnly ? "Bitcoin mining without an explicit AI infrastructure linkage" : infraSignals >= 2 ? "Direct AI infrastructure relevance" : infraSignals ? "Adjacent infrastructure relevance" : "Weak AI infrastructure relevance",
    boilerplate ? `High ${boilerplate[2]} risk` : "No major boilerplate pattern detected",
  ];
  return {
    evidenceQualityScore,
    materialityScore,
    specificityScore,
    relevanceScore,
    boilerplateRisk,
    qualityReasons,
    duplicateGroupId: evidenceDuplicateGroup(input.excerpt),
    suggestion: suggestionFor(value, evidenceQualityScore, relevanceScore, boilerplateRisk),
  };
}
