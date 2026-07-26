import { and, desc, eq, sql } from "drizzle-orm";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";
import { withDatabase } from "@/lib/db/client";
import { companies, comparisonMemos, memoGenerations, publishedReports } from "@/lib/db/schema";
import { verifyMemoSections } from "@/lib/research/memos";
import type { ComparisonMemo, ComparisonMemoSection, ResearchEvidenceItem } from "@/lib/research/types";
import type {
  PublishedReport,
  PublishedReportCompany,
  PublishedReportCompliance,
  PublishedReportGeneration,
  PublishedReportSummary,
} from "@/lib/reports/types";

type ReportSnapshotInput = {
  memo: ComparisonMemo;
  complianceMode: boolean;
  generation: PublishedReportGeneration | null;
  publisher: { name: string; workspaceName: string };
};

function randomPublicToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function claimCount(sections: ComparisonMemoSection[]) {
  return sections.reduce((sum, section) => sum + section.claims.length, 0);
}

function reportAsOfDate(citations: ResearchEvidenceItem[], fallback: string) {
  return citations.map((citation) => citation.documentDate).sort().at(-1) ?? fallback.slice(0, 10);
}

export function buildPublishedReportSnapshot(input: ReportSnapshotInput) {
  const companyIds = [input.memo.companyA.id, input.memo.companyB.id];
  const verified = verifyMemoSections(input.memo.sections, input.memo.citations, companyIds);
  const totalClaims = claimCount(input.memo.sections);
  const verifiedSections = input.memo.isStale
    ? verified.sections.map((section) => section.key === "questions" ? section : { ...section, claims: [] })
    : verified.sections;
  const sections = input.complianceMode ? verifiedSections : input.memo.sections;
  const publishedClaims = claimCount(sections);
  const usedCitationIds = new Set(sections.flatMap((section) => section.claims.flatMap((claim) => claim.citationIds)));
  const citations = input.complianceMode
    ? input.memo.citations.filter((citation) => usedCitationIds.has(citation.id))
    : input.memo.citations;
  const verificationPassed = input.complianceMode
    ? !input.memo.isStale
    : verified.verification.passed && !input.memo.isStale;
  const compliance: PublishedReportCompliance = {
    mode: input.complianceMode ? "compliance" : "standard",
    sourceMemoStale: input.memo.isStale,
    verificationPassed,
    totalClaims,
    publishedClaims,
    withheldClaims: Math.max(0, totalClaims - publishedClaims),
    note: input.memo.isStale
      ? "The source memo was stale at publication, so compliance mode withheld its factual claims."
      : input.complianceMode
        ? verified.verification.passed
          ? "Every published factual claim passed same-company citation verification."
          : "Unsupported claims were withheld from this published version."
        : "Standard mode preserves the complete memo snapshot and displays its verification status.",
  };

  return {
    title: input.memo.title,
    question: input.memo.question,
    topic: input.memo.topic,
    asOfDate: reportAsOfDate(input.memo.citations, input.memo.updatedAt),
    companyA: input.memo.companyA,
    companyB: input.memo.companyB,
    confidenceScore: input.memo.confidenceScore,
    evidenceQualityScore: input.memo.evidenceQualityScore,
    sourceDiversityScore: input.memo.sourceDiversityScore,
    sections,
    citations,
    generation: input.generation,
    compliance,
    publisher: input.publisher,
  };
}

function rowToReport(row: typeof publishedReports.$inferSelect): PublishedReport {
  const companiesSnapshot = row.companySnapshot as { companyA: PublishedReportCompany; companyB: PublishedReportCompany };
  return {
    id: row.id,
    memoId: row.memoId,
    publicToken: row.publicToken,
    path: `/reports/${row.publicToken}`,
    version: row.version,
    title: row.title,
    question: row.question,
    topic: row.topic,
    asOfDate: row.asOfDate,
    companyA: companiesSnapshot.companyA,
    companyB: companiesSnapshot.companyB,
    confidenceScore: row.confidenceScore,
    evidenceQualityScore: row.evidenceQualityScore,
    sourceDiversityScore: row.sourceDiversityScore,
    sections: row.sectionsSnapshot as ComparisonMemoSection[],
    citations: row.evidenceSnapshot as ResearchEvidenceItem[],
    generation: row.generationSnapshot as PublishedReportGeneration | null,
    complianceMode: row.complianceMode,
    compliance: row.complianceSnapshot as PublishedReportCompliance,
    publisher: row.publisherSnapshot as PublishedReport["publisher"],
    revokedAt: row.revokedAt?.toISOString() ?? null,
    publishedAt: row.createdAt.toISOString(),
  };
}

function reportSummary(report: PublishedReport): PublishedReportSummary {
  const { id, memoId, publicToken, path, version, title, asOfDate, complianceMode, compliance, revokedAt, publishedAt } = report;
  return { id, memoId, publicToken, path, version, title, asOfDate, complianceMode, compliance, revokedAt, publishedAt };
}

export async function publishComparisonMemo(memoId: string, complianceMode: boolean, auth: AuthContext) {
  const source = await withDatabase(async (db) => {
    const memo = (await db.select().from(comparisonMemos).where(and(
      eq(comparisonMemos.id, memoId),
      eq(comparisonMemos.workspaceId, auth.workspace.id),
    )).limit(1))[0];
    if (!memo) return null;
    const [companyA, companyB] = await Promise.all([
      db.select().from(companies).where(eq(companies.id, memo.companyAId)).limit(1).then((rows) => rows[0]),
      db.select().from(companies).where(eq(companies.id, memo.companyBId)).limit(1).then((rows) => rows[0]),
    ]);
    if (!companyA || !companyB) return null;
    const generation = (await db.select().from(memoGenerations)
      .where(eq(memoGenerations.memoId, memo.id))
      .orderBy(desc(memoGenerations.createdAt))
      .limit(1))[0];
    return {
      memo: {
        id: memo.id,
        title: memo.title,
        question: memo.question,
        companyA: { id: companyA.id, name: companyA.name, ticker: companyA.ticker },
        companyB: { id: companyB.id, name: companyB.name, ticker: companyB.ticker },
        topic: memo.topic,
        confidenceScore: memo.confidenceScore,
        evidenceQualityScore: memo.evidenceQualityScore,
        sourceDiversityScore: memo.sourceDiversityScore,
        status: memo.status as ComparisonMemo["status"],
        isStale: memo.isStale,
        staleReason: memo.staleReason,
        staleAt: memo.staleAt?.toISOString() ?? null,
        sections: memo.sections as ComparisonMemoSection[],
        citations: memo.evidenceSnapshot as ResearchEvidenceItem[],
        createdAt: memo.createdAt.toISOString(),
        updatedAt: memo.updatedAt.toISOString(),
      } satisfies ComparisonMemo,
      generation: generation ? {
        engine: generation.engine,
        model: generation.model,
        retrievalMode: generation.retrievalMode,
        verification: generation.verification as PublishedReportGeneration["verification"],
      } : null,
    };
  });
  if (!source) throw new Error("Memo not found in this workspace.");

  const snapshot = buildPublishedReportSnapshot({
    memo: source.memo,
    complianceMode,
    generation: source.generation,
    publisher: { name: auth.user.name, workspaceName: auth.workspace.name },
  });
  const id = `report:${crypto.randomUUID()}`;
  const publicToken = randomPublicToken();
  const stored = await withDatabase((db) => db.transaction(async (tx) => {
    await tx.execute(sql`SELECT id FROM comparison_memos WHERE id = ${memoId} FOR UPDATE`);
    const latest = (await tx.select({ version: publishedReports.version }).from(publishedReports)
      .where(eq(publishedReports.memoId, memoId))
      .orderBy(desc(publishedReports.version))
      .limit(1))[0];
    const version = (latest?.version ?? 0) + 1;
    return (await tx.insert(publishedReports).values({
      id,
      workspaceId: auth.workspace.id,
      memoId,
      publishedByUserId: auth.user.id,
      publicToken,
      version,
      title: snapshot.title,
      question: snapshot.question,
      topic: snapshot.topic,
      asOfDate: snapshot.asOfDate,
      companySnapshot: { companyA: snapshot.companyA, companyB: snapshot.companyB },
      confidenceScore: snapshot.confidenceScore,
      evidenceQualityScore: snapshot.evidenceQualityScore,
      sourceDiversityScore: snapshot.sourceDiversityScore,
      sectionsSnapshot: snapshot.sections,
      evidenceSnapshot: snapshot.citations,
      generationSnapshot: snapshot.generation,
      complianceMode,
      complianceSnapshot: snapshot.compliance,
      publisherSnapshot: snapshot.publisher,
    }).returning())[0];
  }));
  if (!stored) throw new Error("Postgres is required to publish research reports.");
  await recordAuditEvent(auth, {
    action: "report.published",
    entityType: "published_report",
    entityId: stored.id,
    summary: `Published ${stored.title} report version ${stored.version}.`,
    metadata: { memoId, version: stored.version, complianceMode, publicPath: `/reports/${stored.publicToken}` },
  });
  return rowToReport(stored);
}

export async function listPublishedReports(memoId: string, workspaceId: string) {
  const rows = await withDatabase((db) => db.select().from(publishedReports).where(and(
    eq(publishedReports.memoId, memoId),
    eq(publishedReports.workspaceId, workspaceId),
  )).orderBy(desc(publishedReports.version)));
  if (!rows) throw new Error("Postgres is required for published reports.");
  return rows.map(rowToReport).map(reportSummary);
}

export async function getPublicReport(publicToken: string) {
  if (!/^[a-f0-9]{64}$/.test(publicToken)) return null;
  const row = await withDatabase(async (db) => (await db.select().from(publishedReports).where(and(
    eq(publishedReports.publicToken, publicToken),
    sql`${publishedReports.revokedAt} IS NULL`,
  )).limit(1))[0] ?? null);
  return row ? rowToReport(row) : null;
}

export async function revokePublishedReport(id: string, auth: AuthContext) {
  const revokedAt = new Date();
  const row = await withDatabase(async (db) => (await db.update(publishedReports).set({ revokedAt }).where(and(
    eq(publishedReports.id, id),
    eq(publishedReports.workspaceId, auth.workspace.id),
    sql`${publishedReports.revokedAt} IS NULL`,
  )).returning())[0] ?? null);
  if (!row) throw new Error("Active published report not found in this workspace.");
  await recordAuditEvent(auth, {
    action: "report.revoked",
    entityType: "published_report",
    entityId: id,
    summary: `Revoked ${row.title} report version ${row.version}.`,
    metadata: { memoId: row.memoId, version: row.version },
  });
  return reportSummary(rowToReport(row));
}

function markdownEscape(value: string) {
  return value.replaceAll("[", "\\[").replaceAll("]", "\\]");
}

export function publishedReportToMarkdown(report: PublishedReport) {
  const citationIndex = new Map(report.citations.map((citation, index) => [citation.id, index + 1]));
  const lines = [
    `# ${report.title}`,
    "",
    `> ${report.question}`,
    "",
    `**Companies:** ${report.companyA.name} (${report.companyA.ticker}) vs. ${report.companyB.name} (${report.companyB.ticker})  `,
    `**Topic:** ${report.topic}  `,
    `**Evidence as of:** ${report.asOfDate}  `,
    `**Published:** ${report.publishedAt.slice(0, 10)} · Version ${report.version}`,
    "",
    `**Confidence:** ${report.confidenceScore}/100 · **Evidence quality:** ${report.evidenceQualityScore}/100 · **Source diversity:** ${report.sourceDiversityScore}/100`,
    "",
    `> ${report.compliance.note}`,
    "",
  ];
  for (const section of report.sections) {
    lines.push(`## ${section.title}`, "");
    if (!section.claims.length) {
      lines.push("_No publishable claims in this section._", "");
      continue;
    }
    for (const claim of section.claims) {
      const company = claim.companyId === report.companyA.id ? report.companyA : report.companyB;
      const citations = claim.citationIds.map((id) => citationIndex.get(id)).filter(Boolean).map((index) => `[${index}]`).join("");
      lines.push(`- **${company.name}:** ${markdownEscape(claim.text)}${citations ? ` ${citations}` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Source Appendix", "");
  for (const [index, citation] of report.citations.entries()) {
    lines.push(`${index + 1}. **${citation.companyName} · ${citation.sourceType}** — ${citation.documentTitle}, ${citation.documentDate}${citation.pageNumber ? `, page ${citation.pageNumber}` : ""}. [Open source](${citation.sourceUrl})`);
    lines.push(`   > ${citation.excerpt.replaceAll("\n", " ")}`, "");
  }
  lines.push("---", "", `Published by ${report.publisher.name} · ${report.publisher.workspaceName}`, "Research only. Verify source documents before making an investment decision.");
  return `${lines.join("\n").trim()}\n`;
}
