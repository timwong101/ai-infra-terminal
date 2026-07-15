export type BriefSection = "change" | "bull" | "bear" | "question";
export type BriefSentiment = "positive" | "negative" | "neutral" | "open";
export type ThesisImpact = "strengthened" | "weakened" | "mixed" | "unchanged";

export type BriefComparisonInput = {
  id: string;
  comparisonKind: "metric" | "disclosure";
  category: string;
  label: string;
  direction: "increased" | "decreased" | "unchanged" | "new" | "changed" | "removed";
  significance: "high" | "medium" | "low";
  summary: string;
  evidenceIds: string[];
  tone: "stronger" | "weaker" | "more uncertain" | "neutral";
};

export type BriefEvidenceInput = {
  id: string;
  sourceQuality: number;
  sourceDocumentId: string;
  sourceType: string;
};

export type BuiltBriefClaim = {
  section: BriefSection;
  title: string;
  text: string;
  sentiment: BriefSentiment;
  significance: "high" | "medium" | "low";
  comparisonId: string | null;
  evidenceIds: string[];
};

export type BuiltEarningsChangeBrief = {
  headline: string;
  summary: string;
  thesisImpact: ThesisImpact;
  confidenceScore: number;
  evidenceQualityScore: number;
  sourceDiversityScore: number;
  changeCount: number;
  claims: BuiltBriefClaim[];
};

const OPPORTUNITY_PATTERN = /revenue|demand|customer|contract|capacity|power|gpu|compute|utilization|pipeline|growth|deployment/i;
const RISK_PATTERN = /debt|borrow|funding|financ|cost|concentrat|delay|risk|constraint|liabilit/i;
const LIQUIDITY_PATTERN = /cash|liquidity/i;

function comparisonSentiment(item: BriefComparisonInput): Exclude<BriefSentiment, "open"> {
  const text = `${item.category} ${item.label} ${item.summary}`;
  if (item.tone === "weaker" || item.tone === "more uncertain") return "negative";
  if (item.tone === "stronger") return "positive";
  if (LIQUIDITY_PATTERN.test(text)) {
    if (item.direction === "increased") return "positive";
    if (["decreased", "removed"].includes(item.direction)) return "negative";
  }
  if (RISK_PATTERN.test(text)) {
    if (["new", "changed", "increased"].includes(item.direction)) return "negative";
    if (["decreased", "removed"].includes(item.direction)) return "positive";
  }
  if (OPPORTUNITY_PATTERN.test(text)) {
    if (["new", "increased"].includes(item.direction)) return "positive";
    if (["decreased", "removed"].includes(item.direction)) return "negative";
  }
  if (item.direction === "increased") return "positive";
  if (["decreased", "removed"].includes(item.direction)) return "negative";
  return "neutral";
}

function rank(item: BriefComparisonInput) {
  const significance = item.significance === "high" ? 3 : item.significance === "medium" ? 2 : 1;
  const direction = item.direction === "unchanged" ? 0 : 1;
  return significance * 10 + direction;
}

function uniqueByLabel(items: BriefComparisonInput[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.label.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function preferMetrics<T extends { item: BriefComparisonInput }>(entries: T[]) {
  return [...entries].sort((left, right) =>
    Number(right.item.comparisonKind === "metric") - Number(left.item.comparisonKind === "metric")
    || rank(right.item) - rank(left.item),
  );
}

function implication(item: BriefComparisonInput, sentiment: "positive" | "negative") {
  const suffix = sentiment === "positive"
    ? "This is supportive of the infrastructure thesis, subject to execution and durability."
    : "This increases risk to the infrastructure thesis and warrants monitoring in the next reporting period.";
  return `${item.summary} ${suffix}`;
}

function openQuestions(comparisons: BriefComparisonInput[]): BuiltBriefClaim[] {
  const covered = comparisons.map((item) => `${item.category} ${item.label}`).join(" ");
  const questions: BuiltBriefClaim[] = [];
  const add = (title: string, text: string) => questions.push({
    section: "question", title, text, sentiment: "open", significance: "medium", comparisonId: null, evidenceIds: [],
  });
  if (!/cash|liquidity|funding|debt|borrow/i.test(covered)) add("Funding durability", "What funding sources and cost of capital will support the next phase of infrastructure expansion?");
  if (!/customer|demand|contract|revenue/i.test(covered)) add("Demand quality", "How concentrated is contracted demand, and what portion is committed or take-or-pay?");
  if (!/power|capacity|gpu|compute|utilization/i.test(covered)) add("Capacity conversion", "How much announced capacity is energized, revenue-generating, and supported by contracted power?");
  if (!/guidance|forecast|outlook|timeline|delivery/i.test(covered)) add("Execution milestones", "Which delivery, utilization, and financing milestones should be tested in the next earnings package?");
  return questions.slice(0, 3);
}

export function buildEarningsChangeBrief(input: {
  companyName: string;
  currentLabel: string;
  previousLabel: string | null;
  periodResolutionConfidence: number;
  comparisons: BriefComparisonInput[];
  evidence: BriefEvidenceInput[];
}): BuiltEarningsChangeBrief {
  const evidenceById = new Map(input.evidence.map((item) => [item.id, item]));
  const grounded = input.comparisons
    .map((item) => ({ ...item, evidenceIds: [...new Set(item.evidenceIds)].filter((id) => evidenceById.has(id)) }))
    .filter((item) => item.evidenceIds.length > 0)
    .sort((left, right) => rank(right) - rank(left));
  const classified = grounded.map((item) => ({ item, sentiment: comparisonSentiment(item) }));
  const positive = classified.filter((entry) => entry.sentiment === "positive");
  const negative = classified.filter((entry) => entry.sentiment === "negative");
  const thesisImpact: ThesisImpact = positive.length && negative.length ? "mixed"
    : positive.length ? "strengthened"
      : negative.length ? "weakened"
        : "unchanged";
  const citedEvidence = [...new Set(grounded.flatMap((item) => item.evidenceIds))].map((id) => evidenceById.get(id)!);
  const evidenceQualityScore = citedEvidence.length
    ? Math.round(citedEvidence.reduce((sum, item) => sum + item.sourceQuality, 0) / citedEvidence.length)
    : 0;
  const sourceDiversityScore = Math.min(100,
    new Set(citedEvidence.map((item) => item.sourceDocumentId)).size * 14
    + new Set(citedEvidence.map((item) => item.sourceType)).size * 8,
  );
  const coverageScore = Math.min(100, grounded.length * 14);
  const confidenceScore = Math.round(
    input.periodResolutionConfidence * .25 + evidenceQualityScore * .35 + sourceDiversityScore * .2 + coverageScore * .2,
  );
  const metricChanges = uniqueByLabel(grounded.filter((item) => item.comparisonKind === "metric"));
  const disclosureChanges = uniqueByLabel(grounded.filter((item) => item.comparisonKind === "disclosure"));
  const selectedChanges = [...metricChanges.slice(0, 4), ...disclosureChanges.slice(0, Math.max(1, 5 - metricChanges.length))].slice(0, 5);
  const changeClaims: BuiltBriefClaim[] = selectedChanges.map((item) => ({
    section: "change", title: item.label, text: item.summary, sentiment: comparisonSentiment(item),
    significance: item.significance, comparisonId: item.id, evidenceIds: item.evidenceIds,
  }));
  const implicationClaims: BuiltBriefClaim[] = [
    ...preferMetrics(positive).slice(0, 2).map(({ item }) => ({
      section: "bull" as const, title: item.label, text: implication(item, "positive"), sentiment: "positive" as const,
      significance: item.significance, comparisonId: item.id, evidenceIds: item.evidenceIds,
    })),
    ...preferMetrics(negative).slice(0, 2).map(({ item }) => ({
      section: "bear" as const, title: item.label, text: implication(item, "negative"), sentiment: "negative" as const,
      significance: item.significance, comparisonId: item.id, evidenceIds: item.evidenceIds,
    })),
  ];
  const previous = input.previousLabel ?? "the prior comparable period";
  const headline = grounded.length
    ? `${input.companyName}'s ${input.currentLabel} evidence ${thesisImpact === "unchanged" ? "did not materially change" : `has a ${thesisImpact} thesis impact`}.`
    : `No grounded material changes were identified for ${input.companyName} in ${input.currentLabel}.`;
  const summary = grounded.length
    ? `${grounded.length} cited changes were identified versus ${previous}: ${positive.length} supportive, ${negative.length} risk-oriented, and ${grounded.length - positive.length - negative.length} neutral.`
    : `The available evidence did not support a material change brief versus ${previous}.`;
  return {
    headline, summary, thesisImpact, confidenceScore, evidenceQualityScore, sourceDiversityScore,
    changeCount: grounded.length, claims: [...changeClaims, ...implicationClaims, ...openQuestions(grounded)],
  };
}
