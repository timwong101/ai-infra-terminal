import { and, asc, desc, eq, lt } from "drizzle-orm";
import { secCompanies } from "@/data/companies";
import { withDatabase } from "@/lib/db/client";
import { companies, irDocuments, irDocumentSections, irEvidencePassages, irSourceDocuments } from "@/lib/db/schema";
import type { IrDocument, IrDocumentDetail, IrEvidenceCache, IrIngestionSummary } from "@/lib/ir/types";

function databaseId(value: string) {
  return value.replace(/[^a-zA-Z0-9:_-]/g, "-");
}

function sourceRowToDocument(row: typeof irSourceDocuments.$inferSelect): IrDocument {
  const company = secCompanies.find((candidate) => candidate.id === row.companyId);
  if (!company) throw new Error(`No company identity is configured for ${row.companyId}.`);
  return {
    id: row.id,
    companyId: row.companyId,
    companyName: company.name,
    ticker: company.ticker,
    documentType: row.documentType as IrDocument["documentType"],
    publishedAt: row.publishedAt,
    title: row.title,
    summary: row.summary,
    sourceUrl: row.sourceUrl,
    sourcePageUrl: row.sourcePageUrl,
    fetchedAt: row.lastSeenAt.toISOString(),
    sourceQuality: row.sourceQuality,
    relevanceScore: row.relevanceScore,
    signal: row.signal as IrDocument["signal"],
  };
}

export async function syncIrSourceCatalog(cache: IrEvidenceCache): Promise<IrIngestionSummary | null> {
  return withDatabase(async (db) => {
    const now = new Date();
    const staleBefore = new Date(now.valueOf() - 30 * 60 * 1000);
    const retryBefore = new Date(now.valueOf() - 60 * 60 * 1000);
    const extractedRows = await db.select({ id: irDocuments.id }).from(irDocuments);
    const extracted = new Set(extractedRows.map((row) => row.id));
    const existingRows = await db.select().from(irSourceDocuments);
    const existing = new Map(existingRows.map((row) => [row.id, row]));

    await db.transaction(async (tx) => {
      const companyIds = new Set(cache.documents.map((document) => document.companyId));
      for (const companyId of companyIds) {
        const company = secCompanies.find((candidate) => candidate.id === companyId);
        if (!company) continue;
        await tx.insert(companies).values({ id: company.id, name: company.name, ticker: company.ticker, cik: company.cik })
          .onConflictDoUpdate({ target: companies.id, set: { name: company.name, ticker: company.ticker, updatedAt: now } });
      }

      for (const document of cache.documents) {
        const prior = existing.get(document.id);
        const status = extracted.has(document.id)
          ? "completed"
          : prior && prior.sourceUrl === document.sourceUrl
            ? prior.extractionStatus
            : "pending";
        await tx.insert(irSourceDocuments).values({
          id: document.id,
          companyId: document.companyId,
          documentType: document.documentType,
          publishedAt: document.publishedAt,
          title: document.title,
          summary: document.summary,
          sourceUrl: document.sourceUrl,
          sourcePageUrl: document.sourcePageUrl,
          sourceQuality: document.sourceQuality,
          relevanceScore: document.relevanceScore,
          signal: document.signal,
          extractionStatus: status,
          completedAt: status === "completed" ? now : null,
        }).onConflictDoUpdate({
          target: irSourceDocuments.id,
          set: {
            companyId: document.companyId,
            documentType: document.documentType,
            publishedAt: document.publishedAt,
            title: document.title,
            summary: document.summary,
            sourceUrl: document.sourceUrl,
            sourcePageUrl: document.sourcePageUrl,
            sourceQuality: document.sourceQuality,
            relevanceScore: document.relevanceScore,
            signal: document.signal,
            extractionStatus: status,
            lastError: status === "pending" ? null : prior?.lastError ?? null,
            lastSeenAt: now,
            completedAt: status === "completed" ? prior?.completedAt ?? now : null,
          },
        });
      }

      await tx.update(irSourceDocuments).set({ extractionStatus: "pending", lastError: "Recovered an interrupted extraction job." })
        .where(and(eq(irSourceDocuments.extractionStatus, "processing"), lt(irSourceDocuments.lastAttemptedAt, staleBefore)));
      await tx.update(irSourceDocuments).set({ extractionStatus: "pending" })
        .where(and(
          eq(irSourceDocuments.extractionStatus, "failed"),
          lt(irSourceDocuments.attempts, 3),
          lt(irSourceDocuments.lastAttemptedAt, retryBefore),
        ));
    });
    return await getIrIngestionSummaryFromDatabase(db);
  });
}

async function getIrIngestionSummaryFromDatabase(db: Parameters<Parameters<typeof withDatabase>[0]>[0]) {
  const rows = await db.select({ status: irSourceDocuments.extractionStatus }).from(irSourceDocuments);
  const summary: IrIngestionSummary = { pending: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of rows) {
    if (row.status in summary) summary[row.status as keyof IrIngestionSummary] += 1;
  }
  return summary;
}

export async function getIrIngestionSummary() {
  return withDatabase((db) => getIrIngestionSummaryFromDatabase(db));
}

export async function getIrSourceDocument(documentId: string) {
  return withDatabase(async (db) => {
    const rows = await db.select().from(irSourceDocuments).where(eq(irSourceDocuments.id, documentId)).limit(1);
    return rows.length ? sourceRowToDocument(rows[0]) : null;
  });
}

export async function claimNextIrSourceDocument() {
  return withDatabase(async (db) => db.transaction(async (tx) => {
    const rows = await tx.select().from(irSourceDocuments)
      .where(eq(irSourceDocuments.extractionStatus, "pending"))
      .orderBy(desc(irSourceDocuments.publishedAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!rows.length) return null;
    const row = rows[0];
    await tx.update(irSourceDocuments).set({
      extractionStatus: "processing",
      attempts: row.attempts + 1,
      lastAttemptedAt: new Date(),
      lastError: null,
    }).where(eq(irSourceDocuments.id, row.id));
    return sourceRowToDocument(row);
  }));
}

export async function markIrSourceDocumentFailed(documentId: string, message: string) {
  return withDatabase(async (db) => {
    await db.update(irSourceDocuments).set({ extractionStatus: "failed", lastError: message.slice(0, 1_000) })
      .where(eq(irSourceDocuments.id, documentId));
    return true;
  });
}

export async function getPersistedIrDocumentDetail(documentId: string): Promise<IrDocumentDetail | null> {
  return withDatabase(async (db) => {
    const rows = await db.select({ document: irDocuments, company: companies })
      .from(irDocuments)
      .innerJoin(companies, eq(irDocuments.companyId, companies.id))
      .where(eq(irDocuments.id, documentId))
      .limit(1);
    if (!rows.length) return null;

    const sectionRows = await db.select().from(irDocumentSections)
      .where(eq(irDocumentSections.documentId, documentId)).orderBy(asc(irDocumentSections.ordinal));
    const sections = [];
    for (const section of sectionRows) {
      const passages = await db.select().from(irEvidencePassages)
        .where(eq(irEvidencePassages.sectionId, section.id)).orderBy(asc(irEvidencePassages.ordinal));
      sections.push({
        id: section.sourceSectionId,
        title: section.title,
        category: section.category,
        pageStart: section.pageStart ?? undefined,
        pageEnd: section.pageEnd ?? undefined,
        passages: passages.map((passage) => ({
          id: passage.sourcePassageId,
          text: passage.text,
          wordCount: passage.wordCount,
          pageNumber: passage.pageNumber ?? undefined,
        })),
      });
    }

    const { document, company } = rows[0];
    return {
      documentId: document.id,
      companyId: company.id,
      companyName: company.name,
      ticker: company.ticker,
      documentType: document.documentType as IrDocumentDetail["documentType"],
      publishedAt: document.publishedAt,
      title: document.title,
      sourceUrl: document.sourceUrl,
      sourcePageUrl: document.sourcePageUrl,
      retrievedAt: document.retrievedAt.toISOString(),
      wordCount: document.wordCount,
      pageCount: document.pageCount,
      sections,
      extraction: {
        method: document.extractionMethod as IrDocumentDetail["extraction"]["method"],
        quality: document.extractionQuality as IrDocumentDetail["extraction"]["quality"],
        message: document.extractionMessage,
      },
    };
  });
}

export async function persistIrDocumentDetail(detail: IrDocumentDetail) {
  const cik = secCompanies.find((company) => company.id === detail.companyId)?.cik;
  if (!cik) throw new Error(`No SEC company identity is configured for ${detail.companyId}.`);
  const result = await withDatabase(async (db) => {
    await db.transaction(async (tx) => {
      await tx.insert(companies).values({ id: detail.companyId, name: detail.companyName, ticker: detail.ticker, cik })
        .onConflictDoUpdate({ target: companies.id, set: { name: detail.companyName, ticker: detail.ticker, updatedAt: new Date() } });
      await tx.insert(irDocuments).values({
        id: detail.documentId,
        companyId: detail.companyId,
        documentType: detail.documentType,
        publishedAt: detail.publishedAt,
        title: detail.title,
        sourceUrl: detail.sourceUrl,
        sourcePageUrl: detail.sourcePageUrl,
        wordCount: detail.wordCount,
        pageCount: detail.pageCount,
        extractionMethod: detail.extraction.method,
        extractionQuality: detail.extraction.quality,
        extractionMessage: detail.extraction.message,
        retrievedAt: new Date(detail.retrievedAt),
      }).onConflictDoUpdate({
        target: irDocuments.id,
        set: {
          title: detail.title,
          sourceUrl: detail.sourceUrl,
          sourcePageUrl: detail.sourcePageUrl,
          wordCount: detail.wordCount,
          pageCount: detail.pageCount,
          extractionMethod: detail.extraction.method,
          extractionQuality: detail.extraction.quality,
          extractionMessage: detail.extraction.message,
          retrievedAt: new Date(detail.retrievedAt),
          updatedAt: new Date(),
        },
      });

      await tx.update(irSourceDocuments).set({
        extractionStatus: "completed",
        completedAt: new Date(),
        lastError: null,
      }).where(eq(irSourceDocuments.id, detail.documentId));

      await tx.delete(irDocumentSections).where(eq(irDocumentSections.documentId, detail.documentId));
      for (const [sectionIndex, section] of detail.sections.entries()) {
        const sectionId = databaseId(`${detail.documentId}:${section.id}`);
        await tx.insert(irDocumentSections).values({
          id: sectionId,
          documentId: detail.documentId,
          sourceSectionId: section.id,
          ordinal: sectionIndex,
          title: section.title,
          category: section.category,
          pageStart: section.pageStart ?? null,
          pageEnd: section.pageEnd ?? null,
        });
        if (section.passages.length) {
          await tx.insert(irEvidencePassages).values(section.passages.map((passage, passageIndex) => ({
            id: databaseId(`${sectionId}:${passage.id}`),
            sectionId,
            sourcePassageId: passage.id,
            ordinal: passageIndex,
            text: passage.text,
            wordCount: passage.wordCount,
            pageNumber: passage.pageNumber ?? null,
          })));
        }
      }
    });
    return true;
  });
  return result ?? false;
}
