import { desc, eq } from "drizzle-orm";
import { withDatabase } from "@/lib/db/client";
import {
  claimEvidence,
  companies,
  comparisonMemos,
  eventClaimImpacts,
  filingChanges,
  filings,
  liveEvents,
  researchClaims,
  researchEvidence,
} from "@/lib/db/schema";
import type { ComparisonMemoSection, ResearchEvidenceItem } from "@/lib/research/types";
import type { LineageEdge, LineageGraph, LineageNode } from "@/lib/lineage/types";

function addNode(nodes: Map<string, LineageNode>, node: LineageNode) {
  if (!nodes.has(node.id)) nodes.set(node.id, node);
}

function addEdge(edges: Map<string, LineageEdge>, edge: Omit<LineageEdge, "id">) {
  const id = `${edge.source}->${edge.target}:${edge.label}`;
  if (!edges.has(id)) edges.set(id, { id, ...edge });
}

function sourceNodeId(item: Pick<ResearchEvidenceItem, "sourceKind" | "sourceDocumentId">) {
  return `source:${item.sourceKind}:${item.sourceDocumentId}`;
}

function addEvidencePacket(nodes: Map<string, LineageNode>, edges: Map<string, LineageEdge>, item: ResearchEvidenceItem) {
  const sourceId = sourceNodeId(item);
  const compliant = item.reviewStatus === "accepted" && item.evidenceQualityScore >= 45 && item.boilerplateRisk < 60;
  addNode(nodes, {
    id: sourceId,
    kind: "source",
    label: item.documentTitle,
    subtitle: `${item.sourceType} · ${item.documentDate}`,
    compliant: true,
    status: item.sourceKind.toUpperCase(),
    score: item.sourceQuality,
    url: item.sourceUrl,
    details: { company: item.companyName, sourceType: item.sourceType, documentDate: item.documentDate },
  });
  addNode(nodes, {
    id: `evidence:${item.id}`,
    kind: "evidence",
    label: item.sectionTitle,
    subtitle: item.excerpt.slice(0, 150),
    compliant,
    status: item.reviewStatus,
    score: item.evidenceQualityScore,
    url: item.sourceUrl,
    details: { topic: item.topic, boilerplateRisk: item.boilerplateRisk, documentDate: item.documentDate },
  });
  addEdge(edges, { source: `company:${item.companyId}`, target: sourceId, label: "published", compliant: true });
  addEdge(edges, { source: sourceId, target: `evidence:${item.id}`, label: "contains", compliant });
}

export async function buildLineageGraph(workspaceId: string): Promise<LineageGraph> {
  const result = await withDatabase(async (db) => {
    const [companyRows, claimRows, linkRows, eventRows, memoRows] = await Promise.all([
      db.select().from(companies),
      db.select().from(researchClaims),
      db.select({ link: claimEvidence, evidence: researchEvidence, change: filingChanges, filing: filings })
        .from(claimEvidence)
        .leftJoin(researchEvidence, eq(claimEvidence.researchEvidenceId, researchEvidence.id))
        .leftJoin(filingChanges, eq(claimEvidence.filingChangeId, filingChanges.id))
        .leftJoin(filings, eq(filingChanges.currentFilingId, filings.id)),
      db.select({ event: liveEvents, impact: eventClaimImpacts })
        .from(liveEvents)
        .leftJoin(eventClaimImpacts, eq(eventClaimImpacts.eventId, liveEvents.id))
        .orderBy(desc(liveEvents.publishedAt))
        .limit(80),
      db.select().from(comparisonMemos).where(eq(comparisonMemos.workspaceId, workspaceId)).orderBy(desc(comparisonMemos.updatedAt)).limit(20),
    ]);
    const companyById = new Map(companyRows.map((item) => [item.id, item]));
    const evidenceRows = await db.select().from(researchEvidence);
    const evidenceById = new Map(evidenceRows.map((item) => [item.id, item]));
    const nodes = new Map<string, LineageNode>();
    const edges = new Map<string, LineageEdge>();

    for (const company of companyRows) addNode(nodes, {
      id: `company:${company.id}`,
      kind: "company",
      label: company.name,
      subtitle: `${company.ticker} · Neoclouds`,
      compliant: true,
      status: "covered",
      score: null,
      url: null,
      details: { ticker: company.ticker, cik: company.cik },
    });

    for (const claim of claimRows) {
      const links = linkRows.filter((item) => item.link.claimId === claim.id);
      const compliant = links.some((item) => item.evidence?.reviewStatus === "accepted" || Boolean(item.filing));
      addNode(nodes, {
        id: `claim:${claim.id}`,
        kind: "claim",
        label: claim.title,
        subtitle: claim.statement,
        compliant,
        status: claim.isStale ? "stale" : compliant ? "supported" : "unsupported",
        score: claim.supportScore,
        url: null,
        details: { theme: claim.theme, kind: claim.kind, evidenceLinks: links.length },
      });
      addEdge(edges, { source: `company:${claim.companyId}`, target: `claim:${claim.id}`, label: "tracks", compliant });
    }

    for (const { link, evidence, change, filing } of linkRows) {
      const claimId = `claim:${link.claimId}`;
      if (evidence) {
        const company = companyById.get(evidence.companyId);
        if (!company) continue;
        const packet = {
          ...evidence,
          companyName: company.name,
          ticker: company.ticker,
          qualityReasons: evidence.qualityReasons as string[],
          suggestedClaimTitle: null,
          reviewedBy: null,
          sourceKind: evidence.sourceKind as "sec" | "ir",
          reviewStatus: evidence.reviewStatus as "accepted" | "unreviewed" | "rejected",
          suggestionStatus: evidence.suggestionStatus as "pending" | "accepted" | "rejected",
          suggestedImpact: evidence.suggestedImpact as "supports" | "weakens" | "watch" | null,
          qualityScoredAt: evidence.qualityScoredAt?.toISOString() ?? null,
          reviewedAt: evidence.reviewedAt?.toISOString() ?? null,
        } satisfies ResearchEvidenceItem;
        addEvidencePacket(nodes, edges, packet);
        const compliant = packet.reviewStatus === "accepted" && packet.evidenceQualityScore >= 45 && packet.boilerplateRisk < 60;
        addEdge(edges, { source: `evidence:${evidence.id}`, target: claimId, label: link.impact, compliant });
      } else if (filing && change) {
        const sourceId = `source:sec:${filing.id}`;
        const changeId = `evidence:filing-change:${change.id}`;
        addNode(nodes, {
          id: sourceId,
          kind: "source",
          label: filing.documentTitle,
          subtitle: `SEC ${filing.formType} · ${filing.filedAt}`,
          compliant: true,
          status: "SEC",
          score: change.relevanceScore,
          url: filing.sourceUrl,
          details: { formType: filing.formType, filedAt: filing.filedAt },
        });
        addNode(nodes, {
          id: changeId,
          kind: "evidence",
          label: change.sectionTitle,
          subtitle: change.summary,
          compliant: true,
          status: change.significance,
          score: change.relevanceScore,
          url: filing.sourceUrl,
          details: { category: change.category, changeType: change.changeType },
        });
        addEdge(edges, { source: `company:${filing.companyId}`, target: sourceId, label: "filed", compliant: true });
        addEdge(edges, { source: sourceId, target: changeId, label: "contains", compliant: true });
        addEdge(edges, { source: changeId, target: claimId, label: link.impact, compliant: true });
      }
    }

    for (const { event, impact } of eventRows) {
      const compliant = event.evidenceStatus === "official" && Boolean(impact?.status === "accepted");
      addNode(nodes, {
        id: `event:${event.id}`,
        kind: "event",
        label: event.title,
        subtitle: `${event.sourceDomain} · ${event.eventType}`,
        compliant,
        status: event.evidenceStatus,
        score: event.materialityScore,
        url: event.sourceUrl,
        details: { credibility: event.credibilityScore, publishedAt: event.publishedAt.toISOString(), sourceKind: event.sourceKind },
      });
      addEdge(edges, { source: `company:${event.companyId}`, target: `event:${event.id}`, label: "discovered", compliant });
      if (impact) addEdge(edges, {
        source: `event:${event.id}`,
        target: `claim:${impact.claimId}`,
        label: `${impact.impact} (${impact.status})`,
        compliant: impact.status === "accepted",
      });
    }

    for (const memo of memoRows) {
      const sections = memo.sections as ComparisonMemoSection[];
      const packet = memo.evidenceSnapshot as ResearchEvidenceItem[];
      for (const item of packet) addEvidencePacket(nodes, edges, item);
      const generatedClaims = sections.flatMap((section) => section.claims.map((claim, index) => ({ section, claim, index })));
      const factualClaims = generatedClaims.filter((item) => item.section.key !== "questions");
      const memoCompliant = !memo.isStale && factualClaims.every(({ claim }) =>
        claim.citationIds.length > 0 && claim.citationIds.every((id) => {
          const evidence = evidenceById.get(id);
          return evidence?.reviewStatus === "accepted" && evidence.evidenceQualityScore >= 45 && evidence.boilerplateRisk < 60;
        })
      );
      addNode(nodes, {
        id: `memo:${memo.id}`,
        kind: "memo",
        label: memo.title,
        subtitle: memo.question,
        compliant: memoCompliant,
        status: memo.isStale ? "stale" : memoCompliant ? "verified" : "unsupported",
        score: memo.confidenceScore,
        url: `/memos/${encodeURIComponent(memo.id)}`,
        details: { topic: memo.topic, citations: packet.length, claims: factualClaims.length },
      });
      for (const { section, claim, index } of generatedClaims) {
        const generatedId = `claim:memo:${memo.id}:${section.key}:${index}`;
        const compliant = section.key === "questions" || (claim.citationIds.length > 0 && claim.citationIds.every((id) => evidenceById.get(id)?.reviewStatus === "accepted"));
        addNode(nodes, {
          id: generatedId,
          kind: "claim",
          label: section.title,
          subtitle: claim.text,
          compliant,
          status: section.key === "questions" ? "open question" : compliant ? "cited" : "unsupported",
          score: null,
          url: null,
          details: { companyId: claim.companyId, section: section.key, citations: claim.citationIds.length },
        });
        addEdge(edges, { source: `company:${claim.companyId}`, target: generatedId, label: "asserts", compliant });
        for (const citationId of claim.citationIds) addEdge(edges, {
          source: `evidence:${citationId}`,
          target: generatedId,
          label: "supports",
          compliant: evidenceById.get(citationId)?.reviewStatus === "accepted",
        });
        addEdge(edges, { source: generatedId, target: `memo:${memo.id}`, label: "included in", compliant });
      }
    }

    const nodeList = [...nodes.values()];
    return {
      nodes: nodeList,
      edges: [...edges.values()].filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)),
      summary: {
        companies: nodeList.filter((item) => item.kind === "company").length,
        sources: nodeList.filter((item) => item.kind === "source").length,
        evidence: nodeList.filter((item) => item.kind === "evidence").length,
        claims: nodeList.filter((item) => item.kind === "claim").length,
        memos: nodeList.filter((item) => item.kind === "memo").length,
        events: nodeList.filter((item) => item.kind === "event").length,
        unsupported: nodeList.filter((item) => !item.compliant).length,
      },
    };
  });
  if (!result) throw new Error("Evidence lineage requires Postgres.");
  return result;
}

