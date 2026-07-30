import { createHash } from "node:crypto";
import type { ExtractionDiffSummary, ExtractionSnapshot } from "@/lib/artifacts/types";

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}
export function stableJson(value: unknown) {
  return JSON.stringify(sortValue(value));
}

export function sha256(value: Uint8Array | string) {
  return createHash("sha256").update(value).digest("hex");
}

export function artifactStorageKey(contentHash: string) {
  return `sha256/${contentHash.slice(0, 2)}/${contentHash.slice(2, 4)}/${contentHash}`;
}

export function extractionOutputHash(snapshot: ExtractionSnapshot) {
  return sha256(stableJson(snapshot));
}

type FlatPassage = { id: string; text: string; wordCount: number };

function flatten(snapshot: ExtractionSnapshot) {
  const passages = new Map<string, FlatPassage>();
  for (const section of snapshot.sections) {
    for (const passage of section.passages) passages.set(`${section.id}:${passage.id}`, { id: passage.id, text: passage.text, wordCount: passage.wordCount });
  }
  return passages;
}

export function countExtractionSnapshot(snapshot: ExtractionSnapshot) {
  return {
    sections: snapshot.sections.length,
    passages: snapshot.sections.reduce((total, section) => total + section.passages.length, 0),
  };
}

export function diffExtractionSnapshots(before: ExtractionSnapshot, after: ExtractionSnapshot): ExtractionDiffSummary {
  const previous = flatten(before);
  const next = flatten(after);
  let addedPassages = 0;
  let removedPassages = 0;
  let changedPassages = 0;
  let unchangedPassages = 0;
  for (const [key, passage] of next) {
    const prior = previous.get(key);
    if (!prior) addedPassages += 1;
    else if (sha256(prior.text) !== sha256(passage.text)) changedPassages += 1;
    else unchangedPassages += 1;
  }
  for (const key of previous.keys()) if (!next.has(key)) removedPassages += 1;
  const previousCount = countExtractionSnapshot(before);
  const nextCount = countExtractionSnapshot(after);
  return {
    beforeSections: previousCount.sections,
    afterSections: nextCount.sections,
    beforePassages: previousCount.passages,
    afterPassages: nextCount.passages,
    addedPassages,
    removedPassages,
    changedPassages,
    unchangedPassages,
    wordCountDelta: after.wordCount - before.wordCount,
  };
}

export function emptyExtractionDiff(snapshot: ExtractionSnapshot): ExtractionDiffSummary {
  const count = countExtractionSnapshot(snapshot);
  return {
    beforeSections: count.sections,
    afterSections: count.sections,
    beforePassages: count.passages,
    afterPassages: count.passages,
    addedPassages: 0,
    removedPassages: 0,
    changedPassages: 0,
    unchangedPassages: count.passages,
    wordCountDelta: 0,
  };
}
