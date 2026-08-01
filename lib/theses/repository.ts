import { and, asc, desc, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { claimEvidence, companies, filingChanges, filings, researchClaims, researchEvidence, thesisSnapshots, workspaceClaimEvidence, workspaceClaimStates } from "@/lib/db/schema";
import type { AuthContext } from "@/lib/auth/types";

export type ThesisEvidenceLink = {
  id: string; impact: string; impactScore: number; rationale: string; sourceType: string; documentTitle: string;
  documentDate: string; excerpt: string; sourceUrl: string | null;
};

export type ThesisDetail = {
  id: string; companyId: string; companyName: string; ticker: string; theme: string; kind: string; title: string;
  statement: string; supportScore: number; status: string; evidence: ThesisEvidenceLink[];
  isStale: boolean; staleReason: string | null; staleAt: string | null;
  snapshots: Array<{ date: string; supportScore: number; evidenceCount: number }>;
};

export async function listTheses(workspaceId: string) {
  const result = await withDatabase(async (db) => {
    const claims = await db.select({ claim: researchClaims, company: companies }).from(researchClaims)
      .innerJoin(companies, eq(researchClaims.companyId, companies.id)).orderBy(desc(researchClaims.supportScore));
    const links = await db.select({ link: claimEvidence, change: filingChanges, filing: filings, evidence: researchEvidence })
      .from(claimEvidence)
      .leftJoin(filingChanges, eq(claimEvidence.filingChangeId, filingChanges.id))
      .leftJoin(filings, eq(filingChanges.currentFilingId, filings.id))
      .leftJoin(researchEvidence, eq(claimEvidence.researchEvidenceId, researchEvidence.id));
    const workspaceLinks = await db.select({ link: workspaceClaimEvidence, evidence: researchEvidence })
      .from(workspaceClaimEvidence)
      .innerJoin(researchEvidence, eq(workspaceClaimEvidence.researchEvidenceId, researchEvidence.id))
      .where(eq(workspaceClaimEvidence.workspaceId, workspaceId));
    const snapshots = await db.select().from(thesisSnapshots).orderBy(asc(thesisSnapshots.snapshotDate));
    const stateRows = await db.select().from(workspaceClaimStates).where(eq(workspaceClaimStates.workspaceId, workspaceId));
    const stateByClaimId = new Map(stateRows.map((state) => [state.claimId, state]));
    return claims.filter(({ claim }) => !claim.kind.startsWith("custom:") || stateByClaimId.has(claim.id)).map(({ claim, company }): ThesisDetail => {
      const state = stateByClaimId.get(claim.id);
      return ({
      id: claim.id, companyId: company.id, companyName: company.name, ticker: company.ticker, theme: claim.theme, kind: claim.kind,
      title: state?.title ?? claim.title, statement: state?.statement ?? claim.statement, supportScore: state?.supportScore ?? claim.supportScore, status: state?.status ?? claim.status,
      isStale: state?.isStale ?? claim.isStale, staleReason: state?.staleReason ?? claim.staleReason, staleAt: (state?.staleAt ?? claim.staleAt)?.toISOString() ?? null,
      evidence: [
        ...links.filter(({ link }) => link.claimId === claim.id).map(({ link, change, filing, evidence }) => ({
          id: link.id, impact: link.impact, impactScore: link.impactScore, rationale: link.rationale,
          sourceType: evidence?.sourceType ?? (filing ? `SEC ${filing.formType}` : "Source evidence"),
          documentTitle: evidence?.documentTitle ?? filing?.documentTitle ?? change?.sectionTitle ?? "Evidence",
          documentDate: evidence?.documentDate ?? filing?.filedAt ?? link.createdAt.toISOString().slice(0, 10),
          excerpt: evidence?.excerpt ?? change?.currentText ?? change?.summary ?? "",
          sourceUrl: evidence?.sourceUrl ?? filing?.sourceUrl ?? null,
        })),
        ...workspaceLinks.filter(({ link }) => link.claimId === claim.id).map(({ link, evidence }) => ({
          id: link.id, impact: link.impact, impactScore: link.impactScore, rationale: link.rationale,
          sourceType: evidence.sourceType,
          documentTitle: evidence.documentTitle,
          documentDate: evidence.documentDate,
          excerpt: evidence.excerpt,
          sourceUrl: evidence.sourceUrl,
        })),
      ].sort((a, b) => b.documentDate.localeCompare(a.documentDate)),
      snapshots: snapshots.filter((item) => item.claimId === claim.id).map((item) => ({ date: item.snapshotDate, supportScore: item.supportScore, evidenceCount: item.evidenceCount })),
      });
    });
  });
  if (!result) throw new Error("Thesis tracking requires a configured database.");
  return result;
}

export async function createThesis(input: { companyId: string; title: string; statement: string }, auth: AuthContext) {
  const id = `claim:${crypto.randomUUID()}`;
  const result = await withDatabase((db) => db.transaction(async (tx) => {
    const rows = await tx.insert(researchClaims).values({ id, companyId: input.companyId, theme: "Neoclouds", kind: `custom:${crypto.randomUUID()}`, title: input.title.trim(), statement: input.statement.trim() }).returning();
    if (!rows[0]) return [];
    await tx.insert(workspaceClaimStates).values({
      id: `${auth.workspace.id}:claim-state:${id}`,
      workspaceId: auth.workspace.id,
      claimId: id,
      title: rows[0].title,
      statement: rows[0].statement,
      status: rows[0].status,
      supportScore: rows[0].supportScore,
      isStale: rows[0].isStale,
      createdByUserId: auth.user.id,
    });
    return rows;
  }));
  if (!result?.[0]) throw new Error("Unable to create this thesis.");
  return result[0];
}

export async function updateThesis(id: string, input: { title?: string; statement?: string; status?: string }, auth: AuthContext) {
  const result = await withDatabase(async (db) => {
    const claim = (await db.select().from(researchClaims).where(eq(researchClaims.id, id)).limit(1))[0];
    if (!claim) return null;
    const current = (await db.select().from(workspaceClaimStates).where(and(eq(workspaceClaimStates.workspaceId, auth.workspace.id), eq(workspaceClaimStates.claimId, id))).limit(1))[0];
    if (claim.kind.startsWith("custom:") && !current) return null;
    const values = {
      title: input.title?.trim() ?? current?.title ?? claim.title,
      statement: input.statement?.trim() ?? current?.statement ?? claim.statement,
      status: input.status ?? current?.status ?? claim.status,
      updatedAt: new Date(),
    };
    const rows = await db.insert(workspaceClaimStates).values({
      id: `${auth.workspace.id}:claim-state:${id}`,
      workspaceId: auth.workspace.id,
      claimId: id,
      ...values,
      supportScore: current?.supportScore ?? claim.supportScore,
      isStale: current?.isStale ?? claim.isStale,
      staleReason: current?.staleReason ?? claim.staleReason,
      staleAt: current?.staleAt ?? claim.staleAt,
      createdByUserId: current?.createdByUserId ?? auth.user.id,
    }).onConflictDoUpdate({
      target: [workspaceClaimStates.workspaceId, workspaceClaimStates.claimId],
      set: values,
    }).returning();
    return rows[0] ? { ...claim, title: rows[0].title ?? claim.title, statement: rows[0].statement ?? claim.statement, status: rows[0].status ?? claim.status } : null;
  });
  if (!result) throw new Error("Thesis not found in this workspace.");
  return result;
}
