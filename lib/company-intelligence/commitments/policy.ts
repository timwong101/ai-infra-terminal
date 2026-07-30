import { extractMetricsFromText } from "@/lib/company-intelligence/extract";
import { analyzeMetricObservation } from "@/lib/company-intelligence/metric-policy";
import type { CommitmentCandidate, CommitmentRevisionKind } from "@/lib/company-intelligence/commitments/types";

const FORWARD_LOOKING = /\b(expect(?:s|ed)?|target(?:s|ed)?|guidance|plan(?:s|ned)?|forecast(?:s|ed)?|project(?:s|ed)?|aim(?:s|ed)?|intend(?:s|ed)?|will|scheduled|under construction|by the end of)\b/i;
const WEAK_INTENT = /\b(could|may|might|approximately|potential(?:ly)?)\b/i;
const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function endOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function resolveCommitmentTargetDate(statement: string) {
  const quarter = statement.match(/\b(?:by|in|during|for)\s+(?:the\s+end\s+of\s+)?Q([1-4])\s+(20\d{2})\b/i);
  if (quarter) {
    const q = Number(quarter[1]);
    return { targetPeriodEnd: endOfMonth(Number(quarter[2]), q * 3), targetDatePrecision: "quarter" as const };
  }
  const month = statement.match(/\bby\s+(?:the\s+end\s+of\s+)?(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
  if (month) return { targetPeriodEnd: endOfMonth(Number(month[2]), MONTHS[month[1].toLowerCase()]), targetDatePrecision: "day" as const };
  const year = statement.match(/\b(?:by|in|during|for|through)\s+(?:the\s+end\s+of\s+)?(?:fiscal\s+|FY\s*)?(20\d{2})\b/i);
  if (year) return { targetPeriodEnd: `${year[1]}-12-31`, targetDatePrecision: "year" as const };
  return { targetPeriodEnd: null, targetDatePrecision: "undated" as const };
}

function sentences(value: string) {
  return value.replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9])/).map((item) => item.trim()).filter(Boolean);
}

export function commitmentIdentityKey(input: Pick<CommitmentCandidate, "metricKey" | "scopeType" | "scopeLabel">) {
  return `${input.metricKey}:${input.scopeType}:${input.scopeLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export function extractCommitmentCandidates(value: string): CommitmentCandidate[] {
  const candidates = new Map<string, CommitmentCandidate>();
  for (const statement of sentences(value)) {
    if (!FORWARD_LOOKING.test(statement)) continue;
    for (const metric of extractMetricsFromText(statement)) {
      const policy = analyzeMetricObservation({
        metricKey: metric.metricKey,
        normalizedValue: metric.normalizedValue,
        context: statement,
        measurementType: "instant",
        periodEnd: new Date().toISOString().slice(0, 10),
        sourceKind: "text",
        valueType: "target",
      });
      if (!policy.canonicalEligible) continue;
      const target = resolveCommitmentTargetDate(statement);
      const candidate: CommitmentCandidate = {
        metricKey: metric.metricKey,
        label: metric.label,
        category: metric.category,
        scopeType: policy.scopeType,
        scopeLabel: policy.scopeLabel,
        statement,
        targetValue: metric.normalizedValue,
        targetDisplay: metric.displayValue,
        targetUnit: metric.unit,
        ...target,
        confidence: Math.max(55, Math.min(96, metric.confidence - (WEAK_INTENT.test(statement) ? 18 : 2) - (target.targetPeriodEnd ? 0 : 8))),
      };
      const key = commitmentIdentityKey(candidate);
      const current = candidates.get(key);
      if (!current || candidate.confidence > current.confidence) candidates.set(key, candidate);
    }
  }
  return [...candidates.values()];
}

export function classifyCommitmentRevision(previous: CommitmentCandidate, next: CommitmentCandidate): CommitmentRevisionKind {
  if (previous.targetValue === next.targetValue && previous.targetPeriodEnd === next.targetPeriodEnd) return "reiterated";
  if (previous.targetPeriodEnd && next.targetPeriodEnd && next.targetPeriodEnd > previous.targetPeriodEnd) return "delayed";
  if (next.targetValue > previous.targetValue) return "raised";
  if (next.targetValue < previous.targetValue) return "lowered";
  return "updated";
}

export function calculateCommitmentVariance(target: number, actual: number) {
  if (!Number.isFinite(target) || !Number.isFinite(actual) || target === 0) return null;
  return Math.round((actual - target) / Math.abs(target) * 100);
}

export function compatibleOutcomeMetricKeys(metricKey: string) {
  if (metricKey === "planned_power_capacity") return ["active_power_capacity", "power_capacity"];
  return [metricKey];
}
