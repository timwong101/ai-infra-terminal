import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import {
  claimEvidence,
  companies,
  filingChanges,
  filings,
  researchAlerts,
  researchClaims,
  thesisSnapshots,
} from "@/lib/db/schema";

type ClaimTemplate = {
  kind: string;
  title: (company: string) => string;
  statement: (company: string) => string;
  categories: string[];
  riskClaim: boolean;
};

export const CLAIM_TEMPLATES: ClaimTemplate[] = [
  { kind: "capacity-growth", title: (c) => `${c} capacity expansion`, statement: (c) => `${c} is expanding powered data center and accelerator capacity to capture AI demand.`, categories: ["Capacity"], riskClaim: false },
  { kind: "demand-growth", title: (c) => `${c} AI demand growth`, statement: (c) => `${c} is converting AI infrastructure demand into durable revenue and contracted workloads.`, categories: ["Demand"], riskClaim: false },
  { kind: "funding-risk", title: (c) => `${c} funding and liquidity risk`, statement: (c) => `${c}'s growth remains dependent on continued access to capital and sufficient liquidity.`, categories: ["Funding"], riskClaim: true },
  { kind: "customer-risk", title: (c) => `${c} customer concentration risk`, statement: (c) => `${c}'s returns remain sensitive to customer concentration and contract durability.`, categories: ["Customer"], riskClaim: true },
  { kind: "execution-risk", title: (c) => `${c} execution risk`, statement: (c) => `${c}'s thesis depends on delivering infrastructure on schedule and sustaining utilization.`, categories: ["Execution"], riskClaim: true },
];

const POSITIVE_PATTERN = /\b(additional|award|backlog|contracted|expanded|expansion|growth|increase|increased|new capacity|sufficient|strong)\b/i;
const NEGATIVE_PATTERN = /\b(adverse|concentration|constraint|debt|decrease|decreased|delay|dependent|impair|loss|risk|uncertain)\b/i;

export function classifyAlertCategory(value: string) {
  if (/capacity|data center|gpu|power|megawatt|mw\b|capital expenditure|capex/i.test(value)) return "Capacity";
  if (/liquidity|financing|debt|capital market|borrow|convertible note/i.test(value)) return "Funding";
  if (/customer|concentration|counterparty/i.test(value)) return "Customer";
  if (/revenue|backlog|demand|contract|workload|utilization/i.test(value)) return "Demand";
  if (/construction|delay|deliver|execution|schedule|operating risk/i.test(value)) return "Execution";
  return "Other";
}

export function classifyAlertImpact(value: string, changeType: string) {
  if (changeType === "explicitly_removed" || changeType === "removed") return "watch" as const;
  const positive = POSITIVE_PATTERN.test(value);
  const negative = NEGATIVE_PATTERN.test(value);
  if (positive && !negative) return "strengthens" as const;
  if (negative && !positive) return "weakens" as const;
  return "watch" as const;
}

export function classifyClaimImpact(impact: "strengthens" | "weakens" | "watch", riskClaim: boolean) {
  if (impact === "watch") return "watch" as const;
  if (riskClaim) return impact === "weakens" ? "supports" as const : "weakens" as const;
  return impact === "strengthens" ? "supports" as const : "weakens" as const;
}

export function isAlertEligibleChange(changeType: string) {
  return changeType !== "not_repeated" && changeType !== "removed";
}

function clampScore(value: number) {
  return Math.max(10, Math.min(90, value));
}

function groupKey(filingId: string, eventKey: string, changeType: string, category: string) {
  return `${filingId}:${eventKey}:${changeType}:${category}`;
}

export async function seedResearchClaims() {
  return withDatabase(async (db) => {
    const companyRows = await db.select().from(companies);
    for (const company of companyRows) {
      for (const template of CLAIM_TEMPLATES) {
        await db.insert(researchClaims).values({
          id: `${company.id}:${template.kind}`,
          companyId: company.id,
          theme: "Neoclouds",
          kind: template.kind,
          title: template.title(company.name),
          statement: template.statement(company.name),
        }).onConflictDoUpdate({
          target: researchClaims.id,
          set: { title: template.title(company.name), statement: template.statement(company.name), updatedAt: new Date() },
        });
      }
    }
    return companyRows;
  });
}

export async function generateResearchAlerts() {
  const companyRows = await seedResearchClaims();
  if (!companyRows) throw new Error("DATABASE_URL is required to generate research alerts.");
  const result = await withDatabase(async (db) => {
    const claimByCompanyAndKind = new Map<string, { id: string; template: ClaimTemplate }>();
    for (const company of companyRows) for (const template of CLAIM_TEMPLATES) {
      claimByCompanyAndKind.set(`${company.id}:${template.kind}`, { id: `${company.id}:${template.kind}`, template });
    }

    const changes = await db.select({ change: filingChanges, filing: filings, company: companies })
      .from(filingChanges)
      .innerJoin(filings, eq(filingChanges.currentFilingId, filings.id))
      .innerJoin(companies, eq(filings.companyId, companies.id))
      .orderBy(asc(filings.filedAt));
    const existing = await db.select({ alert: researchAlerts, change: filingChanges })
      .from(researchAlerts)
      .innerJoin(filingChanges, eq(researchAlerts.filingChangeId, filingChanges.id))
      .where(eq(researchAlerts.alertType, "filing_change"));
    const statusByGroup = new Map(existing.map(({ alert, change }) => [groupKey(alert.filingId ?? "", change.eventCode ?? change.sectionTitle, change.changeType, alert.category), alert.status]));
    await db.delete(claimEvidence).where(isNotNull(claimEvidence.filingChangeId));
    await db.delete(researchAlerts).where(eq(researchAlerts.alertType, "filing_change"));
    await db.delete(researchAlerts).where(and(eq(researchAlerts.alertType, "claim_impact"), isNull(researchAlerts.workspaceId)));

    type ChangeRow = (typeof changes)[number];
    const groups = new Map<string, { category: string; rows: Array<ChangeRow & { impact: "strengthens" | "weakens" | "watch" }> }>();
    let linkedEvidence = 0;
    for (const row of changes) {
      const { change, filing, company } = row;
      if (!isAlertEligibleChange(change.changeType) || (change.changeType === "new_event" && (change.relevanceScore ?? 0) < 45)) continue;
      const text = [change.sectionTitle, change.summary, change.currentText, change.previousText].filter(Boolean).join(" ");
      const category = change.changeType === "new_event" ? change.category : classifyAlertCategory(text);
      if (category === "Other" && change.significance !== "high") continue;
      const impact = classifyAlertImpact(text, change.changeType);
      const key = groupKey(filing.id, change.eventCode ?? change.sectionTitle, change.changeType, category);
      const group = groups.get(key) ?? { category, rows: [] };
      group.rows.push({ ...row, impact });
      groups.set(key, group);

      for (const template of CLAIM_TEMPLATES.filter((item) => item.categories.includes(category))) {
        const claim = claimByCompanyAndKind.get(`${company.id}:${template.kind}`);
        if (!claim) continue;
        const claimImpact = classifyClaimImpact(impact, template.riskClaim);
        const base = change.relevanceScore !== null ? (change.relevanceScore >= 75 ? 12 : change.relevanceScore >= 55 ? 7 : 3) : (change.significance === "high" ? 12 : change.significance === "medium" ? 7 : 3);
        const signed = claimImpact === "supports" ? base : claimImpact === "weakens" ? -base : 0;
        await db.insert(claimEvidence).values({ id: `${claim.id}:${change.id}`, claimId: claim.id, filingChangeId: change.id, impact: claimImpact, impactScore: signed, rationale: change.relevanceReason ?? `${category} disclosure ${claimImpact} this claim.` })
          .onConflictDoUpdate({ target: [claimEvidence.claimId, claimEvidence.filingChangeId], set: { impact: claimImpact, impactScore: signed, rationale: change.relevanceReason ?? `${category} disclosure ${claimImpact} this claim.` } });
        linkedEvidence += 1;
      }
    }

    const rank: Record<string, number> = { low: 0, medium: 1, high: 2 };
    for (const [key, group] of groups) {
      const representative = [...group.rows].sort((a, b) => (rank[b.change.significance] ?? 0) - (rank[a.change.significance] ?? 0))[0];
      const count = group.rows.length;
      await db.insert(researchAlerts).values({
        id: `alert-group:${representative.change.id}`, companyId: representative.company.id, filingId: representative.filing.id,
        filingChangeId: representative.change.id, alertType: "filing_change", category: group.category,
        significance: representative.change.significance, impact: representative.impact,
        title: representative.change.eventType ? `${representative.company.name}: ${representative.change.eventType}` : `${representative.company.name}: ${group.category.toLowerCase()} disclosure changed`,
        summary: count === 1 ? representative.change.relevanceReason ?? representative.change.summary : `${count} related passages support this ${group.category.toLowerCase()} signal.`,
        status: statusByGroup.get(key) ?? "unread",
      });
    }

    // Analyst-approved evidence links are workspace decisions and are maintained
    // by the evidence review transaction, not this global source refresh.
    await db.delete(claimEvidence).where(isNotNull(claimEvidence.researchEvidenceId));

    await db.delete(thesisSnapshots);
    const claims = await db.select().from(researchClaims);
    for (const claim of claims) {
      const rows = await db.execute(sql`
        SELECT ce.*, COALESCE(f.filed_at, re.document_date) AS evidence_date
        FROM claim_evidence ce
        LEFT JOIN filing_changes fc ON fc.id = ce.filing_change_id
        LEFT JOIN filings f ON f.id = fc.current_filing_id
        LEFT JOIN research_evidence re ON re.id = ce.research_evidence_id
        WHERE ce.claim_id = ${claim.id}
        ORDER BY evidence_date ASC, ce.created_at ASC
      `);
      const evidence = rows.rows as Array<{ impact: string; impact_score: number; evidence_date: string }>;
      let score = 50, supporting = 0, weakening = 0;
      const byDate = new Map<string, typeof evidence>();
      for (const item of evidence) byDate.set(item.evidence_date, [...(byDate.get(item.evidence_date) ?? []), item]);
      let evidenceCount = 0;
      for (const [date, datedEvidence] of byDate) {
        for (const item of datedEvidence) {
          score = clampScore(score + item.impact_score);
          evidenceCount += 1;
          if (item.impact === "supports") supporting += 1;
          if (item.impact === "weakens") weakening += 1;
        }
        await db.insert(thesisSnapshots).values({ id: `${claim.id}:${date}`, claimId: claim.id, snapshotDate: date, supportScore: score, evidenceCount, supportingCount: supporting, weakeningCount: weakening });
      }
      await db.update(researchClaims).set({ supportScore: score, isStale: false, staleReason: null, staleAt: null, updatedAt: new Date() }).where(eq(researchClaims.id, claim.id));
    }
    return { claims: claims.length, alerts: groups.size, evidence: linkedEvidence };
  });
  if (!result) throw new Error("DATABASE_URL is required to generate research alerts.");
  return result;
}
