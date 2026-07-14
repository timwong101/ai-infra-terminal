import type {
  EvidencePassage,
  FilingChange,
  FilingChangeSignificance,
  FilingChangeType,
  FilingComparison,
  FilingComparisonMode,
  FilingEvidenceSection,
  SecFilingDetail,
} from "@/lib/evidence/types";
import { normalizeSecEvent, type NormalizedSecEvent } from "@/lib/evidence/sec-event-policy";

const MATERIAL_TERMS = new Set([
  "backlog", "capacity", "capital", "capex", "customer", "customers", "debt", "demand",
  "financing", "liquidity", "power", "revenue", "risk", "risks", "utilization",
]);
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "in", "is",
  "it", "of", "on", "or", "our", "that", "the", "their", "this", "to", "was", "we", "were", "with",
]);
const EVENT_FORMS = new Set(["8-K", "6-K"]);
const RECURRING_CATEGORIES = new Set(["Risk", "Liquidity", "Operations", "Business", "Capacity", "Demand"]);
const RECURRING_TITLE_PATTERN = /management.s discussion|md&a|risk factors|liquidity|results of operations|business|capacity|demand/i;

export function baseFilingForm(formType: string) {
  return formType.toUpperCase().replace(/\/A$/, "");
}

export function getFilingComparisonMode(formType: string): FilingComparisonMode {
  const normalized = formType.toUpperCase();
  if (normalized.endsWith("/A")) return "amendment";
  if (EVENT_FORMS.has(normalized)) return "event";
  return "periodic";
}

function isRecurringSection(section: FilingEvidenceSection) {
  return RECURRING_CATEGORIES.has(section.category) || RECURRING_TITLE_PATTERN.test(section.title);
}

function tokens(value: string) {
  return new Set(
    value.toLowerCase().match(/[a-z0-9]+/g)?.filter((token) => token.length > 1 && !STOP_WORDS.has(token)) ?? [],
  );
}

export function textSimilarity(left: string, right: string) {
  const leftTokens = tokens(left);
  const rightTokens = tokens(right);
  if (leftTokens.size === 0 && rightTokens.size === 0) return 1;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function sectionKey(section: FilingEvidenceSection) {
  const item = section.title.match(/^item\s+([0-9]+(?:\.[0-9]+)?[a-z]?)/i);
  return item ? `item:${item[1].toLowerCase()}` : `${section.category}:${section.title}`.toLowerCase();
}

function changedMaterialTerms(currentText: string, previousText: string) {
  const current = tokens(currentText);
  const previous = tokens(previousText);
  for (const term of MATERIAL_TERMS) {
    if (current.has(term) !== previous.has(term)) return true;
  }
  return false;
}

function significance(type: FilingChange["type"], similarity: number | null, currentText: string, previousText: string): FilingChangeSignificance {
  if (type === "not_repeated") return "low";
  if (type !== "modified") {
    const textTokens = tokens(currentText || previousText);
    return [...MATERIAL_TERMS].some((term) => textTokens.has(term)) ? "high" : "medium";
  }
  if ((similarity ?? 1) < 0.55 || changedMaterialTerms(currentText, previousText)) return "high";
  if ((similarity ?? 1) < 0.75) return "medium";
  return "low";
}

function changeSummary(type: FilingChange["type"], sectionTitle: string, level: FilingChangeSignificance) {
  if (type === "new_event") return `New event disclosure reported in ${sectionTitle}.`;
  if (type === "added") return `New ${level === "high" ? "material " : ""}disclosure added in ${sectionTitle}.`;
  if (type === "not_repeated") return `Prior language was not repeated in ${sectionTitle}; this is not treated as a thesis change.`;
  if (type === "explicitly_removed") return `The filing explicitly states that prior disclosure no longer applies in ${sectionTitle}.`;
  return `${level === "high" ? "Material" : "Disclosure"} language changed in ${sectionTitle}.`;
}

function makeChange(
  type: FilingChange["type"],
  section: FilingEvidenceSection,
  current: EvidencePassage | null,
  previous: EvidencePassage | null,
  similarity: number | null,
  index: number,
  event: NormalizedSecEvent | null = null,
): FilingChange {
  const currentText = current?.text ?? null;
  const previousText = previous?.text ?? null;
  const level = event
    ? event.relevanceScore >= 75 ? "high" : event.relevanceScore >= 55 ? "medium" : "low"
    : significance(type, similarity, currentText ?? "", previousText ?? "");
  return {
    id: `${type}:${section.id}:${index}`,
    type,
    significance: level,
    category: event?.category ?? section.category,
    sectionTitle: section.title,
    summary: event
      ? `${event.eventType} contains ${event.category.toLowerCase()} evidence with ${event.relevanceScore}/100 relevance.`
      : changeSummary(type, section.title, level),
    similarity: similarity === null ? null : Math.round(similarity * 100),
    currentText,
    previousText,
    eventType: event?.eventType ?? null,
    eventCode: event?.eventCode ?? null,
    relevanceScore: event?.relevanceScore ?? null,
    relevanceReason: event?.relevanceReason ?? null,
  };
}

function compareSection(current: FilingEvidenceSection, previous: FilingEvidenceSection | null) {
  if (!previous) {
    return current.passages.map((passage, index) => makeChange("added", current, passage, null, null, index));
  }

  const changes: FilingChange[] = [];
  const matchedPrevious = new Set<number>();

  current.passages.forEach((passage, currentIndex) => {
    let bestIndex = -1;
    let bestSimilarity = 0;
    previous.passages.forEach((candidate, previousIndex) => {
      if (matchedPrevious.has(previousIndex)) return;
      const candidateSimilarity = textSimilarity(passage.text, candidate.text);
      if (candidateSimilarity > bestSimilarity) {
        bestSimilarity = candidateSimilarity;
        bestIndex = previousIndex;
      }
    });

    if (bestIndex >= 0 && bestSimilarity >= 0.35) {
      matchedPrevious.add(bestIndex);
      if (bestSimilarity < 0.9) {
        changes.push(makeChange("modified", current, passage, previous.passages[bestIndex], bestSimilarity, currentIndex));
      }
    } else {
      changes.push(makeChange("added", current, passage, null, null, currentIndex));
    }
  });

  previous.passages.forEach((passage, index) => {
    if (!matchedPrevious.has(index)) changes.push(makeChange("not_repeated", previous, null, passage, null, index));
  });
  return changes;
}

function emptyCounts(): Record<FilingChangeType, number> {
  return { new_event: 0, added: 0, modified: 0, not_repeated: 0, explicitly_removed: 0 };
}

export function compareFilings(current: SecFilingDetail, previous: SecFilingDetail | null = null): FilingComparison | null {
  const mode = getFilingComparisonMode(current.formType);
  if (mode === "event") {
    const changes = current.sections.flatMap((section) => section.passages.flatMap((passage, index) => {
      const event = normalizeSecEvent(current.formType, section, passage);
      return event.eligible ? [makeChange("new_event", section, passage, null, null, index, event)] : [];
    }));
    const counts = emptyCounts();
    counts.new_event = changes.length;
    return {
      mode,
      policyLabel: "Standalone event filing",
      currentFilingId: current.filingId,
      previousFiling: null,
      counts,
      changes: changes.slice(0, 16),
    };
  }

  if (!previous) return null;

  const currentSections = mode === "periodic" ? current.sections.filter(isRecurringSection) : current.sections;
  const priorSections = mode === "periodic" ? previous.sections.filter(isRecurringSection) : previous.sections;
  const previousSections = new Map(priorSections.map((section) => [sectionKey(section), section]));
  const matchedSections = new Set<string>();
  const changes: FilingChange[] = [];

  for (const section of currentSections) {
    const key = sectionKey(section);
    const priorSection = previousSections.get(key) ?? null;
    if (priorSection) matchedSections.add(key);
    changes.push(...compareSection(section, priorSection));
  }

  for (const section of priorSections) {
    const key = sectionKey(section);
    if (matchedSections.has(key)) continue;
    changes.push(...section.passages.map((passage, index) => makeChange("not_repeated", section, null, passage, null, index)));
  }

  const rank = { high: 0, medium: 1, low: 2 } as const;
  const prioritized = changes
    .sort((left, right) => {
      if (left.type === "not_repeated" && right.type !== "not_repeated") return 1;
      if (right.type === "not_repeated" && left.type !== "not_repeated") return -1;
      return rank[left.significance] - rank[right.significance];
    })
    .slice(0, 16);

  const counts = emptyCounts();
  for (const change of changes) counts[change.type] += 1;

  return {
    mode,
    policyLabel: mode === "amendment" ? "Amendment compared with base filing" : "Recurring sections compared with prior period",
    currentFilingId: current.filingId,
    previousFiling: {
      filingId: previous.filingId,
      formType: previous.formType,
      filedAt: previous.filedAt,
      sourceUrl: previous.sourceUrl,
    },
    counts,
    changes: prioritized,
  };
}
