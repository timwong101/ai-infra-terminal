import { asc, eq } from "drizzle-orm";
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

const CLAIM_TEMPLATES: ClaimTemplate[] = [
  {
    kind: "capacity-growth",
    title: (company) => `${company} capacity expansion`,
    statement: (company) => `${company} is expanding powered data center and accelerator capacity to capture AI demand.`,
    categories: ["Capacity"],
    riskClaim: false,
  },
  {
    kind: "demand-growth",
    title: (company) => `${company} AI demand growth`,
    statement: (company) => `${company} is converting AI infrastructure demand into durable revenue and contracted workloads.`,
    categories: ["Demand"],
    riskClaim: false,
  },
  {
    kind: "funding-risk",
    title: (company) => `${company} funding and liquidity risk`,
    statement: (company) => `${company}'s growth remains dependent on continued access to capital and sufficient liquidity.`,
    categories: ["Funding"],
    riskClaim: true,
  },
  {
    kind: "customer-risk",
    title: (company) => `${company} customer concentration risk`,
    statement: (company) => `${company}'s returns remain sensitive to customer concentration and contract durability.`,
    categories: ["Customer"],
    riskClaim: true,
  },
  {
    kind: "execution-risk",
    title: (company) => `${company} execution risk`,
    statement: (company) => `${company}'s thesis depends on delivering infrastructure on schedule and sustaining utilization.`,
    categories: ["Execution"],
    riskClaim: true,
  },
];

const POSITIVE_PATTERN = /\b(additional|award|contracted|expanded|expansion|growth|increase|increased|new capacity|sufficient|strong)\b/i;
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

export async function generateResearchAlerts() {
  const result = await withDatabase(async (db) => {
    const companyRows = await db.select().from(companies);
    const claimByCompanyAndKind = new Map<string, { id: string; template: ClaimTemplate }>();

    for (const company of companyRows) {
      for (const template of CLAIM_TEMPLATES) {
        const id = `${company.id}:${template.kind}`;
        await db.insert(researchClaims).values({
          id,
          companyId: company.id,
          theme: "Neoclouds",
          kind: template.kind,
          title: template.title(company.name),
          statement: template.statement(company.name),
        }).onConflictDoUpdate({
          target: researchClaims.id,
          set: {
            title: template.title(company.name),
            statement: template.statement(company.name),
            updatedAt: new Date(),
          },
        });
        claimByCompanyAndKind.set(`${company.id}:${template.kind}`, { id, template });
      }
    }

    const changes = await db
      .select({ change: filingChanges, filing: filings, company: companies })
      .from(filingChanges)
      .innerJoin(filings, eq(filingChanges.currentFilingId, filings.id))
      .innerJoin(companies, eq(filings.companyId, companies.id))
      .orderBy(asc(filings.filedAt));

    const existingAlerts = await db
      .select({ alert: researchAlerts, change: filingChanges })
      .from(researchAlerts)
      .innerJoin(filingChanges, eq(researchAlerts.filingChangeId, filingChanges.id));
    const statusPriority: Record<string, number> = { unread: 0, dismissed: 1, reviewed: 2, watching: 3 };
    const statusByGroup = new Map<string, string>();
    for (const { alert, change } of existingAlerts) {
      const key = groupKey(alert.filingId, change.eventCode ?? change.sectionTitle, change.changeType, alert.category);
      const existingStatus = statusByGroup.get(key) ?? "unread";
      if ((statusPriority[alert.status] ?? 0) > (statusPriority[existingStatus] ?? 0)) statusByGroup.set(key, alert.status);
      else if (!statusByGroup.has(key)) statusByGroup.set(key, existingStatus);
    }

    await db.delete(claimEvidence);
    await db.delete(thesisSnapshots);
    await db.delete(researchAlerts);

    type ChangeRow = (typeof changes)[number];
    const alertGroups = new Map<string, { category: string; rows: Array<ChangeRow & { impact: "strengthens" | "weakens" | "watch" }> }>();
    let linkedEvidence = 0;
    for (const { change, filing, company } of changes) {
      if (!isAlertEligibleChange(change.changeType)) continue;
      if (change.changeType === "new_event" && (change.relevanceScore ?? 0) < 45) continue;
      const sourceText = [change.sectionTitle, change.summary, change.currentText, change.previousText].filter(Boolean).join(" ");
      const category = change.changeType === "new_event" ? change.category : classifyAlertCategory(sourceText);
      if (category === "Other" && change.significance !== "high") continue;

      const impact = classifyAlertImpact(sourceText, change.changeType);
      const key = groupKey(filing.id, change.eventCode ?? change.sectionTitle, change.changeType, category);
      const group = alertGroups.get(key) ?? { category, rows: [] };
      group.rows.push({ change, filing, company, impact });
      alertGroups.set(key, group);

      for (const template of CLAIM_TEMPLATES.filter((candidate) => candidate.categories.includes(category))) {
        const claim = claimByCompanyAndKind.get(`${company.id}:${template.kind}`);
        if (!claim) continue;
        const evidenceImpact = classifyClaimImpact(impact, template.riskClaim);
        const baseScore = change.relevanceScore !== null
          ? change.relevanceScore >= 75 ? 12 : change.relevanceScore >= 55 ? 7 : 3
          : change.significance === "high" ? 12 : change.significance === "medium" ? 7 : 3;
        const signedScore = evidenceImpact === "supports" ? baseScore : evidenceImpact === "weakens" ? -baseScore : 0;
        await db.insert(claimEvidence).values({
          id: `${claim.id}:${change.id}`,
          claimId: claim.id,
          filingChangeId: change.id,
          impact: evidenceImpact,
          impactScore: signedScore,
          rationale: change.relevanceReason ?? `${change.significance} significance ${category.toLowerCase()} change ${evidenceImpact} this claim.`,
        }).onConflictDoUpdate({
          target: [claimEvidence.claimId, claimEvidence.filingChangeId],
          set: { impact: evidenceImpact, impactScore: signedScore, rationale: change.relevanceReason ?? `${change.significance} significance ${category.toLowerCase()} change ${evidenceImpact} this claim.` },
        });
        linkedEvidence += 1;
      }
    }

    const significanceRank: Record<string, number> = { low: 0, medium: 1, high: 2 };
    const impactRank: Record<string, number> = { watch: 0, strengthens: 1, weakens: 2 };
    for (const [key, group] of alertGroups) {
      const representative = [...group.rows].sort((left, right) =>
        (significanceRank[right.change.significance] ?? 0) - (significanceRank[left.change.significance] ?? 0),
      )[0];
      const significance = representative.change.significance;
      const impact = [...group.rows].sort((left, right) => impactRank[right.impact] - impactRank[left.impact])[0].impact;
      const status = statusByGroup.get(key) ?? "unread";
      const count = group.rows.length;
      const changeLabel = representative.change.changeType.replaceAll("_", " ");
      const eventTitle = representative.change.eventType
        ? `${representative.company.name}: ${representative.change.eventType}`
        : `${representative.company.name}: ${group.category.toLowerCase()} disclosure ${changeLabel}`;
      await db.insert(researchAlerts).values({
        id: `alert-group:${representative.change.id}`,
        companyId: representative.company.id,
        filingId: representative.filing.id,
        filingChangeId: representative.change.id,
        category: group.category,
        significance,
        impact,
        title: eventTitle,
        summary: count === 1
          ? representative.change.relevanceReason ?? representative.change.summary
          : representative.change.eventType
            ? `${count} material excerpts support this ${group.category.toLowerCase()} event signal.`
            : `${count} related passages marked ${changeLabel} in ${representative.change.sectionTitle}.`,
        status,
        reviewedAt: status === "reviewed" ? new Date() : null,
      });
    }

    const claims = await db.select().from(researchClaims);
    for (const claim of claims) {
      const evidence = await db
        .select({ evidence: claimEvidence, filing: filings })
        .from(claimEvidence)
        .innerJoin(filingChanges, eq(claimEvidence.filingChangeId, filingChanges.id))
        .innerJoin(filings, eq(filingChanges.currentFilingId, filings.id))
        .where(eq(claimEvidence.claimId, claim.id))
        .orderBy(asc(filings.filedAt));

      let score = 50;
      let supporting = 0;
      let weakening = 0;
      const byDate = new Map<string, typeof evidence>();
      for (const row of evidence) {
        score = clampScore(score + row.evidence.impactScore);
        if (row.evidence.impact === "supports") supporting += 1;
        if (row.evidence.impact === "weakens") weakening += 1;
        const dated = byDate.get(row.filing.filedAt) ?? [];
        dated.push(row);
        byDate.set(row.filing.filedAt, dated);
      }
      await db.update(researchClaims).set({ supportScore: score, updatedAt: new Date() }).where(eq(researchClaims.id, claim.id));

      let cumulativeScore = 50;
      let cumulativeEvidence = 0;
      let cumulativeSupporting = 0;
      let cumulativeWeakening = 0;
      for (const [snapshotDate, rows] of byDate) {
        for (const row of rows) {
          cumulativeScore = clampScore(cumulativeScore + row.evidence.impactScore);
          cumulativeEvidence += 1;
          if (row.evidence.impact === "supports") cumulativeSupporting += 1;
          if (row.evidence.impact === "weakens") cumulativeWeakening += 1;
        }
        await db.insert(thesisSnapshots).values({
          id: `${claim.id}:${snapshotDate}`,
          claimId: claim.id,
          snapshotDate,
          supportScore: cumulativeScore,
          evidenceCount: cumulativeEvidence,
          supportingCount: cumulativeSupporting,
          weakeningCount: cumulativeWeakening,
        }).onConflictDoUpdate({
          target: [thesisSnapshots.claimId, thesisSnapshots.snapshotDate],
          set: {
            supportScore: cumulativeScore,
            evidenceCount: cumulativeEvidence,
            supportingCount: cumulativeSupporting,
            weakeningCount: cumulativeWeakening,
          },
        });
      }
    }

    return { claims: companyRows.length * CLAIM_TEMPLATES.length, alerts: alertGroups.size, evidence: linkedEvidence };
  });
  if (!result) throw new Error("DATABASE_URL is required to generate research alerts.");
  return result;
}
