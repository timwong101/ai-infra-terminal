import type { ComparisonMemoSection, MemoClaim, MemoVerification, ResearchEvidenceItem } from "@/lib/research/types";

type SectionKey = ComparisonMemoSection["key"];
type SynthesisDiagnostics = Required<Pick<
  MemoVerification,
  "synthesisFallbackClaims" | "duplicateClaims" | "numericFidelityFailures" | "quoteFidelityFailures" | "semanticSupportFailures" | "malformedClaims"
>>;

const STOP_WORDS = new Set([
  "about", "after", "also", "been", "being", "between", "could", "disclosed", "from", "have", "into",
  "more", "most", "over", "reported", "that", "their", "there", "these", "they", "this", "through",
  "under", "which", "with", "would", "company", "group",
]);

export const GROUNDING_POLICY_VERSION = "lexical-numeric-polarity-v3";

const NEGATION_PATTERN = /\b(?:cannot|can't|did not|didn't|does not|doesn't|failed to|has not|hasn't|have not|haven't|is not|isn't|never|no|not|was not|wasn't|were not|weren't|without)\b/i;
const DIRECTIONAL_TERMS = [
  { positive: /\b(?:above|exceed(?:ed|s|ing)?|higher|increase(?:d|s|ing)?|grew|growth|rose)\b/i, negative: /\b(?:below|decline(?:d|s|ing)?|decrease(?:d|s|ing)?|fell|lower|shrank)\b/i },
  { positive: /\b(?:before|earlier)\b/i, negative: /\b(?:after|later)\b/i },
  { positive: /\b(?:gain(?:ed|s|ing)?|profit(?:able|ability|s)?)\b/i, negative: /\b(?:loss(?:es)?|lost|unprofitable)\b/i },
] as const;

const SECTION_PATTERNS: Record<Exclude<SectionKey, "questions" | "summary">, RegExp> = {
  exposure: /\b(ai|capacity|cloud|compute|data cent(?:er|re)|gpu|hpc|infrastructure|megawatt|mw\b|gigawatt|gw\b|power)\b/i,
  advantages: /\b(availability|capital investment|contracted|demand|expand|growth|increase|infrastructure business|launch|liquidity|scale|secured|signed)\b/i,
  risks: /\b(capital|concentrat|constraint|cost|credit|debt|delay|dependent|financ|liquidity|loss|risk|uncertain)\b/i,
  catalysts: /\b(availability|capacity|contract|deliver|deploy|energiz|expand|guidance|launch|milestone|pipeline)\b/i,
};

const WHY_IT_MATTERS: Record<string, string> = {
  "Power & capacity": "Shows how much infrastructure can be energized and converted into usable AI capacity.",
  "Customers & demand": "Helps assess demand durability, utilization visibility, and customer concentration.",
  "Financing & liquidity": "Frames whether growth can be funded without undermining balance-sheet resilience.",
  "Compute & accelerators": "Connects disclosed hardware access directly to the company's AI compute exposure.",
  Networking: "Indicates whether interconnect capability can support larger and more demanding AI clusters.",
  "Operations & execution": "Provides a measurable signal for delivery timing and execution risk.",
  "Competition & strategy": "Clarifies the positioning that may strengthen or weaken the company's differentiation.",
  "Risk factors": "Identifies a disclosed constraint that could pressure execution, utilization, or returns.",
  "Company developments": "Adds a monitorable company-specific development to the infrastructure thesis.",
};

function normalizeText(value: string) {
  return value
    .replace(/\\"/g, "\"")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[“”]/g, "\"")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeForComparison(value: string) {
  return normalizeText(value)
    .replace(/^["']|["']$/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9$%£€.' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function unitName(value: string) {
  const normalized = value.toLowerCase().replace(/\./g, "");
  if (["b", "bn", "billion"].includes(normalized)) return "billion";
  if (["m", "mn", "million"].includes(normalized)) return "million";
  if (["k", "thousand"].includes(normalized)) return "thousand";
  if (["%", "percent"].includes(normalized)) return "percent";
  if (["bps", "basis point", "basis points"].includes(normalized)) return "basis-points";
  return normalized;
}

export function extractNumericFacts(value: string) {
  const prepared = normalizeText(value).replace(/(\d)-(?=(?:year|month|quarter)\b)/gi, "$1 ");
  const pattern = /([$€£]\s*)?\d[\d,]*(?:\.\d+)?\s*(%|percent|basis points?|bps|mw|gw|kw|billion|million|thousand|bn|mn|years?|months?|quarters?|gpus?|buildings?|customers?|b|m|k)?/gi;
  return [...prepared.matchAll(pattern)].map((match) => {
    const currency = match[1]?.trim() || "";
    const number = match[0].replace(match[1] ?? "", "").replace(match[2] ?? "", "").replaceAll(",", "").trim();
    const unit = unitName(match[2] ?? "");
    return `${currency}${number}${unit ? `:${unit}` : ""}`.toLowerCase();
  });
}

export function verifyNumericFidelity(text: string, evidence: ResearchEvidenceItem[]) {
  const allowed = new Set(evidence.flatMap((item) => extractNumericFacts(item.excerpt)));
  const claimFacts = extractNumericFacts(text);
  const unsupported = claimFacts.filter((fact) => !allowed.has(fact));
  return { passed: unsupported.length === 0, facts: claimFacts, unsupported };
}

function contentTokens(value: string) {
  return new Set(normalizeForComparison(value)
    .split(/\s+/)
    .map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter((token) => token.length >= 4 && !STOP_WORDS.has(token) && !/^\d+$/.test(token)));
}

export function claimEvidenceSupport(text: string, evidence: ResearchEvidenceItem[]) {
  const claimTokens = contentTokens(text);
  if (!claimTokens.size) return { passed: false, overlap: 0, contradiction: false, reason: "no-content-tokens" as const };
  const sourceScores = evidence.map((item) => {
    const itemTokens = contentTokens(item.excerpt);
    const itemMatches = [...claimTokens].filter((token) => itemTokens.has(token)).length;
    return { item, matched: itemMatches, overlap: itemMatches / claimTokens.size };
  });
  const overlap = Math.max(0, ...sourceScores.map((score) => score.overlap));
  const comparableSources = sourceScores.filter((score) => score.matched >= Math.min(3, claimTokens.size) && score.overlap >= 0.24);
  const conflicts = comparableSources.filter(({ item }) => {
    const polarityConflict = NEGATION_PATTERN.test(text) !== NEGATION_PATTERN.test(item.excerpt);
    const directionalConflict = DIRECTIONAL_TERMS.some(({ positive, negative }) =>
      (positive.test(text) && negative.test(item.excerpt)) || (negative.test(text) && positive.test(item.excerpt)));
    return polarityConflict || directionalConflict;
  });
  const lexicalSupport = comparableSources.length > 0;
  const contradiction = lexicalSupport && conflicts.length === comparableSources.length;
  return {
    passed: lexicalSupport && !contradiction,
    overlap,
    contradiction,
    reason: !lexicalSupport ? "insufficient-lexical-support" as const : contradiction ? "polarity-conflict" as const : "supported" as const,
  };
}

export function isMalformedClaimText(value: string) {
  const text = normalizeText(value);
  const words = text.split(/\s+/);
  if (text.length < 24 || text.length > 420 || words.length < 5) return true;
  if (/^[a-z]{2,}\s/.test(text)) return true;
  if (/^(?:company timeline|ai factories hyperscalers capex estimates)\b/i.test(text)) return true;
  if (/based on company guidance \+ analyst consensus|approximate calendar-year basis/i.test(text)) return true;
  if (/\bwww\.[^\s]+|\b\d+\s*\/\s*\d+\b/i.test(text)) return true;
  if ((text.match(/\b20\d{2}\b/g) ?? []).length >= 4) return true;
  const numericDensity = words.filter((word) => /\d/.test(word)).length / words.length;
  if (numericDensity > 0.32) return true;
  return /(?:\b[A-Z]{2,}\b\s*){7,}/.test(text);
}

function quoteMatchesEvidence(text: string, evidence: ResearchEvidenceItem[]) {
  const quote = normalizeForComparison(text);
  return evidence.some((item) => normalizeForComparison(item.excerpt).includes(quote));
}

function sentenceCandidates(item: ResearchEvidenceItem, key: SectionKey) {
  const excerpt = normalizeText(item.excerpt)
    .replace(/^\d{1,3}\s+(?=[A-Z"'])/, "")
    .replace(/^[•·▪◦-]\s*/, "");
  const slideFragment = /^(?:company timeline|ai factories hyperscalers capex estimates)\b/i.test(excerpt);
  const escapedCompany = item.companyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const fragmentPatterns = [
    new RegExp(`\\b${escapedCompany}\\s+has\\s+secured\\s+[$€£]\\s?\\d[\\d,.]*\\s*(?:billion|million|bn|mn|b|m)?[^.;]{0,80}?(?:contracted lease value|contract value)`, "i"),
    /\bsigned\b[^.;]{20,220}?\b\d[\d,.]*\s*(?:mw|gw)\b(?:\s+of\s+(?:critical\s+)?it\s+load)?/i,
    /\brevenue growth\b[^.;]{20,180}?(?:customer acquisition|program enhancements|year over year|yoy)/i,
    /\b\d[\d,.]*\s+billion in total contracted baseline revenue under \d[\d,.]*-year take-or-pay lease agreements/i,
  ];
  const fragments = fragmentPatterns.flatMap((pattern) => excerpt.match(pattern) ?? []);
  const sentences = [
    ...fragments,
    ...excerpt.split(/(?<=[.!?])\s+(?=["'A-Z])/).map((value) => value.trim()).filter(Boolean),
  ];
  const pattern = key === "summary" || key === "questions" ? null : SECTION_PATTERNS[key];
  return sentences.map((text, index) => {
    const wordCount = text.split(/\s+/).length;
    const isExtractedFragment = fragments.includes(text);
    const readable = (isExtractedFragment || !slideFragment) && !isMalformedClaimText(text);
    const score = (readable ? 45 : -30)
      + (wordCount >= 10 && wordCount <= 48 ? 20 : 0)
      + (pattern?.test(text) ? 20 : 0)
      + (extractNumericFacts(text).length ? 8 : 0)
      + (isExtractedFragment ? 16 : 0)
      + Math.max(0, 8 - index * 2);
    return { text, score, readable };
  }).sort((left, right) => right.score - left.score);
}

function whyItMatters(item: ResearchEvidenceItem, key: SectionKey) {
  if (key === "summary") return "Establishes a concise, evidence-backed anchor for the company's infrastructure thesis.";
  if (key === "exposure") return "Connects the disclosure directly to the company's AI infrastructure exposure.";
  if (key === "advantages") return "Identifies a disclosed factor that may strengthen positioning or execution.";
  if (key === "risks") return "Highlights a disclosed constraint that could pressure execution, utilization, or returns.";
  if (key === "catalysts") return "Creates a specific milestone the analyst can monitor as the thesis develops.";
  return WHY_IT_MATTERS[item.topic] ?? WHY_IT_MATTERS["Company developments"];
}

function paraphraseSourceSentence(item: ResearchEvidenceItem, sentence: string) {
  const normalized = normalizeText(sentence);
  if (/^".*"\s*,?\s*(?:said|stated|according to)\b/i.test(normalized)) return normalized;
  const text = normalized.replace(/^["']|["']$/g, "");
  const lowerInitial = (value: string) => /^[A-Z]{2,}\b/.test(value) ? value : `${value[0].toLowerCase()}${value.slice(1)}`;
  if (/^we\s+/i.test(text)) return `${item.companyName} ${text.replace(/^we\s+/i, "").replace(/^expect\b/i, "expects").replace(/^believe\b/i, "believes")}`;
  if (/^our\s+/i.test(text)) return `${item.companyName}'s ${text.replace(/^our\s+/i, "")}`;
  if (text.toLowerCase().startsWith(item.companyName.toLowerCase())) return text;
  if (/^(completed|contracted|entered|established|launched|reported|secured|signed)\b/i.test(text)) {
    return `${item.companyName} ${lowerInitial(text)}`;
  }
  if (/^(revenue|capacity|cash|liquidity|capital expenditures?|backlog)\b/i.test(text)) {
    return `${item.companyName} reported ${lowerInitial(text)}`;
  }
  if (/^as of\b/i.test(text)) return `${item.companyName} reported that ${lowerInitial(text)}`;
  return `${item.companyName} disclosed that ${lowerInitial(text)}`;
}

export function createDeterministicMemoClaim(item: ResearchEvidenceItem, key: SectionKey): MemoClaim {
  const selected = sentenceCandidates(item, key).find((candidate) => candidate.readable)?.text;
  if (!selected) return sourceFallbackClaim(item, key);
  const text = paraphraseSourceSentence(item, selected);
  const representation = normalizeForComparison(text) === normalizeForComparison(selected) ? "quote" : "paraphrase";
  const support = claimEvidenceSupport(text, [item]);
  const fidelity = verifyNumericFidelity(text, [item]);
  if (!support.passed || !fidelity.passed || isMalformedClaimText(text)) return sourceFallbackClaim(item, key);
  return {
    companyId: item.companyId,
    text,
    citationIds: [item.id],
    representation,
    synthesisStatus: "verified",
    whyItMatters: whyItMatters(item, key),
    qualityScore: Math.max(0, Math.min(100, Math.round(item.evidenceQualityScore * .8 + support.overlap * 20))),
  };
}

function sourceFallbackClaim(item: ResearchEvidenceItem, key: SectionKey): MemoClaim {
  const candidates = sentenceCandidates(item, key);
  const text = candidates.find((candidate) => candidate.readable)?.text
    ?? normalizeText(item.excerpt).slice(0, 380).trim().replace(/\s+\S*$/, "");
  return {
    companyId: item.companyId,
    text,
    citationIds: [item.id],
    representation: "quote",
    synthesisStatus: "source-fallback",
    whyItMatters: whyItMatters(item, key),
    qualityScore: Math.max(0, Math.min(100, item.evidenceQualityScore - 8)),
  };
}

function claimSimilarity(left: MemoClaim, right: MemoClaim) {
  const leftTokens = contentTokens(left.text);
  const rightTokens = contentTokens(right.text);
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / new Set([...leftTokens, ...rightTokens]).size;
}

function emptyDiagnostics(): SynthesisDiagnostics {
  return {
    synthesisFallbackClaims: 0,
    duplicateClaims: 0,
    numericFidelityFailures: 0,
    quoteFidelityFailures: 0,
    semanticSupportFailures: 0,
    malformedClaims: 0,
  };
}

export function synthesizeMemoSections(
  sections: ComparisonMemoSection[],
  evidence: ResearchEvidenceItem[],
  companyIds: string[],
) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const diagnostics = emptyDiagnostics();
  let rejectedClaims = 0;
  const seen: MemoClaim[] = [];
  const synthesized = sections.map((section) => {
    const claims: MemoClaim[] = [];
    for (const candidate of section.claims) {
      if (!companyIds.includes(candidate.companyId) || !candidate.text.trim()) {
        rejectedClaims += 1;
        continue;
      }
      if (section.key === "questions") {
        claims.push({
          ...candidate,
          citationIds: [],
          representation: "question",
          synthesisStatus: "not-applicable",
          whyItMatters: candidate.whyItMatters || "Defines an evidence gap that should be resolved before conviction increases.",
        });
        continue;
      }
      const cited = [...new Set(candidate.citationIds)].map((id) => evidenceById.get(id)).filter((item): item is ResearchEvidenceItem => Boolean(item));
      if (!cited.length || cited.some((item) => item.companyId !== candidate.companyId)) {
        rejectedClaims += 1;
        continue;
      }
      const numeric = verifyNumericFidelity(`${candidate.text} ${candidate.whyItMatters ?? ""}`, cited);
      const support = claimEvidenceSupport(candidate.text, cited);
      const representation = candidate.representation === "quote" ? "quote" : "paraphrase";
      const quoteValid = representation !== "quote" || quoteMatchesEvidence(candidate.text, cited);
      const malformed = isMalformedClaimText(candidate.text);
      if (!numeric.passed) diagnostics.numericFidelityFailures += 1;
      if (!support.passed) diagnostics.semanticSupportFailures += 1;
      if (!quoteValid) diagnostics.quoteFidelityFailures += 1;
      if (malformed) diagnostics.malformedClaims += 1;
      const needsFallback = !numeric.passed || !support.passed || !quoteValid || malformed;
      const wasFallback = candidate.synthesisStatus === "source-fallback";
      const claim: MemoClaim = needsFallback
        ? sourceFallbackClaim(cited.sort((left, right) => right.evidenceQualityScore - left.evidenceQualityScore)[0], section.key)
        : {
            ...candidate,
            citationIds: [...new Set(candidate.citationIds)],
            representation,
            synthesisStatus: wasFallback ? "source-fallback" as const : "verified" as const,
            whyItMatters: candidate.whyItMatters?.trim() || whyItMatters(cited[0], section.key),
            qualityScore: Math.max(0, Math.min(100, Math.round(
              cited.reduce((sum, item) => sum + item.evidenceQualityScore, 0) / cited.length * .8 + support.overlap * 20,
            ))),
          };
      const duplicate = seen.some((existing) =>
        existing.companyId === claim.companyId
        && (normalizeForComparison(existing.text) === normalizeForComparison(claim.text) || claimSimilarity(existing, claim) >= .82)
      );
      if (duplicate) {
        diagnostics.duplicateClaims += 1;
        continue;
      }
      if (needsFallback || wasFallback) diagnostics.synthesisFallbackClaims += 1;
      seen.push(claim);
      claims.push(claim);
    }
    return { ...section, claims };
  });
  return { sections: synthesized, diagnostics, rejectedClaims };
}

export function verifySynthesizedClaim(claim: MemoClaim, evidence: ResearchEvidenceItem[]) {
  const numeric = verifyNumericFidelity(`${claim.text} ${claim.whyItMatters ?? ""}`, evidence);
  const support = claimEvidenceSupport(claim.text, evidence);
  const quoteValid = claim.representation !== "quote" || quoteMatchesEvidence(claim.text, evidence);
  return {
    passed: numeric.passed && support.passed && quoteValid && !isMalformedClaimText(claim.text),
    numeric,
    support,
    quoteValid,
  };
}
