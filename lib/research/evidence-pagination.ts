export type EvidenceCursor = { quality: number; date: string; id: string };

export function encodeEvidenceCursor(cursor: EvidenceCursor) {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeEvidenceCursor(value?: string): EvidenceCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<EvidenceCursor>;
    if (!Number.isInteger(parsed.quality) || (parsed.quality ?? -1) < 0 || (parsed.quality ?? 101) > 100) return null;
    if (typeof parsed.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) return null;
    if (typeof parsed.id !== "string" || !parsed.id) return null;
    return parsed as EvidenceCursor;
  } catch {
    return null;
  }
}
