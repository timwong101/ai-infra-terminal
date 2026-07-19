import { and, asc, desc, eq } from "drizzle-orm";
import type { AlertStatus, AlertsResponse, ResearchAlert, ResearchClaim } from "@/lib/alerts/types";
import { withDatabase } from "@/lib/db/client";
import {
  claimEvidence,
  companies,
  filingChanges,
  filings,
  researchAlerts,
  researchClaims,
  researchEvidence,
  thesisSnapshots,
  userAlertStates,
} from "@/lib/db/schema";
import type { AuthContext } from "@/lib/auth/types";
import { recordAuditEvent } from "@/lib/auth/session";

type AlertFilters = {
  status?: string;
  company?: string;
  category?: string;
  significance?: string;
};

export async function listResearchAlerts(filters: AlertFilters = {}, auth: AuthContext): Promise<AlertsResponse> {
  const result = await withDatabase(async (db) => {
    const rows = await db
      .select({ alert: researchAlerts, company: companies, filing: filings, change: filingChanges, evidence: researchEvidence })
      .from(researchAlerts)
      .innerJoin(companies, eq(researchAlerts.companyId, companies.id))
      .leftJoin(filings, eq(researchAlerts.filingId, filings.id))
      .leftJoin(filingChanges, eq(researchAlerts.filingChangeId, filingChanges.id))
      .leftJoin(researchEvidence, eq(researchAlerts.researchEvidenceId, researchEvidence.id))
      .orderBy(desc(researchAlerts.createdAt));

    const stateRows = await db.select().from(userAlertStates).where(and(eq(userAlertStates.workspaceId, auth.workspace.id), eq(userAlertStates.userId, auth.user.id)));
    const stateByAlert = new Map(stateRows.map((item) => [item.alertId, item.status as AlertStatus]));
    const allAlerts: ResearchAlert[] = rows.map(({ alert, company, filing, change, evidence }) => ({
      id: alert.id,
      companyId: company.id,
      companyName: company.name,
      ticker: company.ticker,
      filingId: filing?.id ?? null,
      formType: filing?.formType ?? evidence?.sourceType ?? "Reviewed evidence",
      filedAt: filing?.filedAt ?? evidence?.documentDate ?? alert.createdAt.toISOString().slice(0, 10),
      sourceUrl: filing?.sourceUrl ?? evidence?.sourceUrl ?? null,
      alertType: alert.alertType as ResearchAlert["alertType"],
      category: alert.category,
      significance: alert.significance as ResearchAlert["significance"],
      impact: alert.impact as ResearchAlert["impact"],
      title: alert.title,
      summary: alert.summary,
      sectionTitle: change?.sectionTitle ?? evidence?.sectionTitle ?? "Accepted evidence",
      changeType: change?.changeType as ResearchAlert["changeType"] ?? "reviewed_evidence",
      similarity: change?.similarity ?? null,
      eventType: change?.eventType ?? null,
      eventCode: change?.eventCode ?? null,
      relevanceScore: change?.relevanceScore ?? evidence?.sourceQuality ?? null,
      relevanceReason: change?.relevanceReason ?? alert.summary,
      status: stateByAlert.get(alert.id) ?? "unread",
      createdAt: alert.createdAt.toISOString(),
    }));

    const alerts = allAlerts.filter((alert) =>
      (!filters.status || filters.status === "all" || alert.status === filters.status) &&
      (!filters.company || filters.company === "all" || alert.companyId === filters.company) &&
      (!filters.category || filters.category === "all" || alert.category === filters.category) &&
      (!filters.significance || filters.significance === "all" || alert.significance === filters.significance),
    );

    const claimRows = await db
      .select({ claim: researchClaims, company: companies })
      .from(researchClaims)
      .innerJoin(companies, eq(researchClaims.companyId, companies.id))
      .where(eq(researchClaims.status, "active"))
      .orderBy(desc(researchClaims.supportScore));
    const allClaimEvidence = await db.select().from(claimEvidence);
    const allSnapshots = await db.select().from(thesisSnapshots).orderBy(asc(thesisSnapshots.snapshotDate));
    const claims: ResearchClaim[] = [];
    for (const { claim, company } of claimRows) {
      const evidence = allClaimEvidence.filter((item) => item.claimId === claim.id);
      const snapshots = allSnapshots.filter((snapshot) => snapshot.claimId === claim.id);
      claims.push({
        id: claim.id,
        companyId: company.id,
        companyName: company.name,
        ticker: company.ticker,
        kind: claim.kind,
        title: claim.title,
        statement: claim.statement,
        supportScore: claim.supportScore,
        evidenceCount: evidence.length,
        supportingCount: evidence.filter((item) => item.impact === "supports").length,
        weakeningCount: evidence.filter((item) => item.impact === "weakens").length,
        snapshots: snapshots.map((snapshot) => ({
          date: snapshot.snapshotDate,
          supportScore: snapshot.supportScore,
          evidenceCount: snapshot.evidenceCount,
          supportingCount: snapshot.supportingCount,
          weakeningCount: snapshot.weakeningCount,
        })),
      });
    }

    return {
      alerts: alerts.slice(0, 150),
      claims,
      summary: {
        total: allAlerts.length,
        unread: allAlerts.filter((alert) => alert.status === "unread").length,
        high: allAlerts.filter((alert) => alert.significance === "high" && alert.status !== "dismissed").length,
        watching: allAlerts.filter((alert) => alert.status === "watching").length,
        reviewed: allAlerts.filter((alert) => alert.status === "reviewed").length,
      },
      filters: {
        companies: [...new Map(rows.map(({ company }) => [company.id, { id: company.id, name: company.name, ticker: company.ticker }])).values()],
        categories: [...new Set(allAlerts.map((alert) => alert.category))].sort(),
      },
    };
  });
  if (!result) throw new Error("Research alerts require a configured database.");
  return result;
}

export async function updateResearchAlertStatus(id: string, status: AlertStatus, auth: AuthContext) {
  const result = await withDatabase(async (db) => {
    const alert = (await db.select({ id: researchAlerts.id, title: researchAlerts.title }).from(researchAlerts).where(eq(researchAlerts.id, id)).limit(1))[0];
    if (!alert) return null;
    const stateId = `alert-state:${auth.workspace.id}:${auth.user.id}:${id}`;
    const updated = await db.insert(userAlertStates).values({ id: stateId, workspaceId: auth.workspace.id, userId: auth.user.id, alertId: id, status, reviewedAt: status === "reviewed" ? new Date() : null, updatedAt: new Date() }).onConflictDoUpdate({ target: [userAlertStates.workspaceId, userAlertStates.userId, userAlertStates.alertId], set: { status, reviewedAt: status === "reviewed" ? new Date() : null, updatedAt: new Date() } }).returning({ id: userAlertStates.alertId, status: userAlertStates.status });
    return { ...(updated[0] ?? { id, status }), title: alert.title };
  });
  if (!result) throw new Error("Alert not found.");
  await recordAuditEvent(auth, { action: "alert.status_changed", entityType: "research_alert", entityId: id, summary: `Marked ${result.title} as ${status}.`, metadata: { status } });
  return { id: result.id, status: result.status };
}
