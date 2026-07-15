import { asc, desc, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import { claimEvidence, companies, filingChanges, filings, researchClaims, researchEvidence, thesisSnapshots } from "@/lib/db/schema";

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

export async function listTheses() {
  const result = await withDatabase(async (db) => {
    const claims = await db.select({ claim: researchClaims, company: companies }).from(researchClaims)
      .innerJoin(companies, eq(researchClaims.companyId, companies.id)).orderBy(desc(researchClaims.supportScore));
    const links = await db.select({ link: claimEvidence, change: filingChanges, filing: filings, evidence: researchEvidence })
      .from(claimEvidence)
      .leftJoin(filingChanges, eq(claimEvidence.filingChangeId, filingChanges.id))
      .leftJoin(filings, eq(filingChanges.currentFilingId, filings.id))
      .leftJoin(researchEvidence, eq(claimEvidence.researchEvidenceId, researchEvidence.id));
    const snapshots = await db.select().from(thesisSnapshots).orderBy(asc(thesisSnapshots.snapshotDate));
    return claims.map(({ claim, company }): ThesisDetail => ({
      id: claim.id, companyId: company.id, companyName: company.name, ticker: company.ticker, theme: claim.theme, kind: claim.kind,
      title: claim.title, statement: claim.statement, supportScore: claim.supportScore, status: claim.status,
      isStale: claim.isStale, staleReason: claim.staleReason, staleAt: claim.staleAt?.toISOString() ?? null,
      evidence: links.filter(({ link }) => link.claimId === claim.id).map(({ link, change, filing, evidence }) => ({
        id: link.id, impact: link.impact, impactScore: link.impactScore, rationale: link.rationale,
        sourceType: evidence?.sourceType ?? (filing ? `SEC ${filing.formType}` : "Source evidence"),
        documentTitle: evidence?.documentTitle ?? filing?.documentTitle ?? change?.sectionTitle ?? "Evidence",
        documentDate: evidence?.documentDate ?? filing?.filedAt ?? link.createdAt.toISOString().slice(0, 10),
        excerpt: evidence?.excerpt ?? change?.currentText ?? change?.summary ?? "",
        sourceUrl: evidence?.sourceUrl ?? filing?.sourceUrl ?? null,
      })).sort((a, b) => b.documentDate.localeCompare(a.documentDate)),
      snapshots: snapshots.filter((item) => item.claimId === claim.id).map((item) => ({ date: item.snapshotDate, supportScore: item.supportScore, evidenceCount: item.evidenceCount })),
    }));
  });
  if (!result) throw new Error("Thesis tracking requires a configured database.");
  return result;
}

export async function createThesis(input: { companyId: string; title: string; statement: string }) {
  const id = `claim:${crypto.randomUUID()}`;
  const result = await withDatabase((db) => db.insert(researchClaims).values({ id, companyId: input.companyId, theme: "Neoclouds", kind: `custom:${crypto.randomUUID()}`, title: input.title.trim(), statement: input.statement.trim() }).returning());
  if (!result?.[0]) throw new Error("Unable to create this thesis.");
  return result[0];
}

export async function updateThesis(id: string, input: { title?: string; statement?: string; status?: string }) {
  const result = await withDatabase((db) => db.update(researchClaims).set({ ...input, updatedAt: new Date() }).where(eq(researchClaims.id, id)).returning());
  if (!result?.[0]) throw new Error("Thesis not found.");
  return result[0];
}
