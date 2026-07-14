import { and, asc, eq, notInArray } from "drizzle-orm";
import type { FilingComparison, SecFilingDetail } from "@/lib/evidence/types";
import { withDatabase } from "@/lib/db/client";
import { companies, evidencePassages, filingChanges, filings, filingSections } from "@/lib/db/schema";

function databaseId(value: string) {
  return value.replace(/[^a-zA-Z0-9:_-]/g, "-");
}

export async function getPersistedFilingDetail(filingId: string): Promise<SecFilingDetail | null> {
  return withDatabase(async (db) => {
    const rows = await db
      .select({ filing: filings, company: companies })
      .from(filings)
      .innerJoin(companies, eq(filings.companyId, companies.id))
      .where(eq(filings.id, filingId))
      .limit(1);
    if (rows.length === 0) return null;

    const sectionRows = await db.select().from(filingSections).where(eq(filingSections.filingId, filingId)).orderBy(asc(filingSections.ordinal));
    const sections = [];
    for (const section of sectionRows) {
      const passages = await db.select().from(evidencePassages).where(eq(evidencePassages.sectionId, section.id)).orderBy(asc(evidencePassages.ordinal));
      sections.push({
        id: section.sourceSectionId,
        title: section.title,
        category: section.category,
        itemCode: section.itemCode ?? undefined,
        passages: passages.map((passage) => ({
          id: passage.sourcePassageId,
          text: passage.text,
          wordCount: passage.wordCount,
        })),
      });
    }

    const { filing, company } = rows[0];
    return {
      filingId: filing.id,
      companyId: company.id,
      companyName: company.name,
      ticker: company.ticker,
      formType: filing.formType,
      filedAt: filing.filedAt,
      accessionNumber: filing.accessionNumber,
      documentTitle: filing.documentTitle,
      sourceUrl: filing.sourceUrl,
      retrievedAt: filing.retrievedAt.toISOString(),
      wordCount: filing.wordCount,
      sections,
      extraction: {
        method: "deterministic-html" as const,
        quality: filing.extractionQuality as SecFilingDetail["extraction"]["quality"],
        message: filing.extractionMessage,
      },
    };
  });
}

export async function persistFilingDetail(detail: SecFilingDetail) {
  const result = await withDatabase(async (db) => {
    await db.transaction(async (tx) => {
    await tx.insert(companies).values({
      id: detail.companyId,
      name: detail.companyName,
      ticker: detail.ticker,
      cik: detail.filingId.split(":")[1],
    }).onConflictDoUpdate({
      target: companies.id,
      set: { name: detail.companyName, ticker: detail.ticker, updatedAt: new Date() },
    });

    await tx.insert(filings).values({
      id: detail.filingId,
      companyId: detail.companyId,
      accessionNumber: detail.accessionNumber,
      formType: detail.formType,
      filedAt: detail.filedAt,
      sourceUrl: detail.sourceUrl,
      documentTitle: detail.documentTitle,
      wordCount: detail.wordCount,
      extractionQuality: detail.extraction.quality,
      extractionMessage: detail.extraction.message,
      retrievedAt: new Date(detail.retrievedAt),
    }).onConflictDoUpdate({
      target: filings.id,
      set: {
        documentTitle: detail.documentTitle,
        wordCount: detail.wordCount,
        extractionQuality: detail.extraction.quality,
        extractionMessage: detail.extraction.message,
        retrievedAt: new Date(detail.retrievedAt),
        updatedAt: new Date(),
      },
    });

    await tx.delete(filingSections).where(eq(filingSections.filingId, detail.filingId));
    for (const [sectionIndex, section] of detail.sections.entries()) {
      const sectionId = databaseId(`${detail.filingId}:${section.id}`);
      await tx.insert(filingSections).values({
        id: sectionId,
        filingId: detail.filingId,
        sourceSectionId: section.id,
        ordinal: sectionIndex,
        title: section.title,
        category: section.category,
        itemCode: section.itemCode ?? null,
      });
      if (section.passages.length > 0) {
        await tx.insert(evidencePassages).values(section.passages.map((passage, passageIndex) => ({
          id: databaseId(`${sectionId}:${passage.id}`),
          sectionId,
          sourcePassageId: passage.id,
          ordinal: passageIndex,
          text: passage.text,
          wordCount: passage.wordCount,
        })));
      }
    }
    });
    return true;
  });
  return result ?? false;
}

export async function persistFilingComparison(comparison: FilingComparison) {
  const result = await withDatabase(async (db) => {
    await db.transaction(async (tx) => {
      const previousFilingId = comparison.previousFiling?.filingId ?? null;
      const comparisonKey = previousFilingId ?? "standalone";
      const values = comparison.changes.map((change, index) => ({
        id: databaseId(`${comparison.currentFilingId}:${comparisonKey}:${index}`),
        currentFilingId: comparison.currentFilingId,
        previousFilingId,
        comparisonMode: comparison.mode,
        ordinal: index,
        changeType: change.type,
        significance: change.significance,
        category: change.category,
        sectionTitle: change.sectionTitle,
        summary: change.summary,
        similarity: change.similarity,
        currentText: change.currentText,
        previousText: change.previousText,
        eventType: change.eventType,
        eventCode: change.eventCode,
        relevanceScore: change.relevanceScore,
        relevanceReason: change.relevanceReason,
      }));

      for (const value of values) {
        await tx.insert(filingChanges).values(value).onConflictDoUpdate({
          target: [filingChanges.currentFilingId, filingChanges.ordinal],
          set: {
            ordinal: value.ordinal,
            previousFilingId: value.previousFilingId,
            comparisonMode: value.comparisonMode,
            changeType: value.changeType,
            significance: value.significance,
            category: value.category,
            sectionTitle: value.sectionTitle,
            summary: value.summary,
            similarity: value.similarity,
            currentText: value.currentText,
            previousText: value.previousText,
            eventType: value.eventType,
            eventCode: value.eventCode,
            relevanceScore: value.relevanceScore,
            relevanceReason: value.relevanceReason,
          },
        });
      }

      const currentCondition = eq(filingChanges.currentFilingId, comparison.currentFilingId);
      await tx.delete(filingChanges).where(
        values.length > 0
          ? and(currentCondition, notInArray(filingChanges.ordinal, values.map((value) => value.ordinal)))
          : currentCondition,
      );
    });
    return true;
  });
  return result ?? false;
}
