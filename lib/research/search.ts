import { sql } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { getAcceptedEvidence } from "@/lib/research/evidence";
import type { ResearchEvidenceItem } from "@/lib/research/types";

type RankedRow = { id: string; score: number };

function lexicalFallback(items: ResearchEvidenceItem[], query: string) {
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
  return [...items].sort((left, right) => {
    const score = (item: ResearchEvidenceItem) => {
      const value = `${item.topic} ${item.sectionTitle} ${item.excerpt}`.toLowerCase();
      return terms.reduce((total, term) => total + (value.includes(term) ? 1 : 0), 0) + item.evidenceQualityScore / 100;
    };
    return score(right) - score(left);
  });
}

async function embedQuery(value: string) {
  if (!process.env.OPENAI_API_KEY?.trim()) return null;
  const [{ embed }, { openai }] = await Promise.all([import("ai"), import("@ai-sdk/openai")]);
  const result = await embed({
    model: openai.embedding(process.env.AI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small"),
    value,
  });
  return result.embedding;
}

export async function backfillResearchEmbeddings(limit = 40) {
  if (!process.env.OPENAI_API_KEY?.trim()) return { embedded: 0, skipped: true };
  const rows = await withDatabase((db) => db.execute(sql`
    SELECT id, excerpt FROM research_evidence
    WHERE review_status = 'accepted' AND evidence_quality_score >= 45 AND boilerplate_risk < 60 AND embedding IS NULL
    ORDER BY evidence_quality_score DESC, document_date DESC
    LIMIT ${Math.max(1, Math.min(limit, 100))}
  `));
  if (!rows?.rows.length) return { embedded: 0, skipped: false };

  const [{ embedMany }, { openai }] = await Promise.all([import("ai"), import("@ai-sdk/openai")]);
  const input = rows.rows as Array<{ id: string; excerpt: string }>;
  const result = await embedMany({
    model: openai.embedding(process.env.AI_EMBEDDING_MODEL?.trim() || "text-embedding-3-small"),
    values: input.map((item) => item.excerpt),
    maxParallelCalls: 2,
  });
  await withDatabase(async (db) => {
    for (const [index, item] of input.entries()) {
      await db.execute(sql`
        UPDATE research_evidence
        SET embedding = ${JSON.stringify(result.embeddings[index])}::vector, embedded_at = now()
        WHERE id = ${item.id}
      `);
    }
  });
  return { embedded: input.length, skipped: false };
}

export async function searchAcceptedEvidence(input: {
  companyIds: string[];
  topic?: string;
  query: string;
  limit?: number;
}) {
  const all = await getAcceptedEvidence(input.companyIds, input.topic);
  const query = `${input.topic === "All topics" ? "" : input.topic ?? ""} ${input.query}`.trim();
  if (!query) return { items: all.slice(0, input.limit ?? 20), mode: "quality" as const };

  let embedding: number[] | null = null;
  try {
    embedding = await embedQuery(query);
  } catch {
    embedding = null;
  }

  try {
    const ids = sql.join(input.companyIds.map((id) => sql`${id}`), sql`, `);
    const topicFilter = input.topic && input.topic !== "All topics" ? sql`AND topic = ${input.topic}` : sql``;
    const vectorScore = embedding
      ? sql`CASE WHEN embedding IS NULL THEN 0 ELSE 1 - (embedding <=> ${JSON.stringify(embedding)}::vector) END`
      : sql`0`;
    const result = await withDatabase((db) => db.execute(sql`
      SELECT id,
        (0.58 * ts_rank_cd(to_tsvector('english', excerpt), websearch_to_tsquery('english', ${query})))
        + (0.42 * ${vectorScore})
        + (evidence_quality_score / 10000.0) AS score
      FROM research_evidence
      WHERE review_status = 'accepted' AND evidence_quality_score >= 45 AND boilerplate_risk < 60 AND company_id IN (${ids}) ${topicFilter}
      ORDER BY score DESC, document_date DESC
      LIMIT ${Math.max(1, Math.min(input.limit ?? 20, 50))}
    `));
    const ranked = (result?.rows ?? []) as RankedRow[];
    const byId = new Map(all.map((item) => [item.id, item]));
    const items = ranked.map((row) => byId.get(row.id)).filter((item): item is ResearchEvidenceItem => Boolean(item));
    return {
      items: items.length ? items : lexicalFallback(all, query).slice(0, input.limit ?? 20),
      mode: embedding ? "hybrid" as const : "full-text" as const,
    };
  } catch {
    return { items: lexicalFallback(all, query).slice(0, input.limit ?? 20), mode: "lexical" as const };
  }
}
