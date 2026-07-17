import { createHash } from "node:crypto";
import { Client } from "pg";
import { secCompanies } from "@/data/companies";

const connectionString = process.env.E2E_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (process.env.E2E_TEST !== "1") throw new Error("Refusing to seed unless E2E_TEST=1.");
if (!connectionString) throw new Error("E2E_DATABASE_URL is required to seed end-to-end tests.");

const databaseName = decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, ""));
if (!/(?:^|_)(?:e2e|test)$/.test(databaseName)) {
  throw new Error(`Refusing to seed non-test database "${databaseName}". Use a database name ending in _e2e or _test.`);
}

const client = new Client({ connectionString });
await client.connect();

const evidenceTemplates = [
  {
    key: "capacity",
    topic: "Power & capacity",
    title: "Q1 2026 Infrastructure Update",
    date: "2026-03-31",
    text: (name: string) => `${name} reported 200 MW of active AI data center capacity and said another 300 MW remains under construction for contracted GPU deployments.`,
  },
  {
    key: "demand",
    topic: "Customers & demand",
    title: "Q1 2026 Customer Update",
    date: "2026-03-31",
    text: (name: string) => `${name} signed a multi-year AI infrastructure agreement that increased contracted backlog to $1.2 billion while preserving delivery milestones.`,
  },
  {
    key: "financing",
    topic: "Financing & liquidity",
    title: "Q4 2025 Financing Update",
    date: "2025-12-31",
    text: (name: string) => `${name} ended the quarter with $800 million of liquidity and $450 million of debt, leaving execution dependent on disciplined construction spending.`,
  },
] as const;

try {
  await client.query("BEGIN");
  await client.query("TRUNCATE TABLE companies CASCADE");

  for (const company of secCompanies) {
    await client.query(
      "INSERT INTO companies (id, name, ticker, cik) VALUES ($1, $2, $3, $4)",
      [company.id, company.name, company.ticker, company.cik],
    );
    const claimId = `${company.id}:capacity_growth`;
    await client.query(
      `INSERT INTO research_claims (id, company_id, theme, kind, title, statement, support_score)
       VALUES ($1, $2, 'Neoclouds', 'capacity_growth', 'Capacity growth', $3, 60)`,
      [claimId, company.id, `${company.name} can convert announced power and GPU capacity into active, revenue-producing infrastructure.`],
    );

    for (const template of evidenceTemplates) {
      const id = `e2e:${company.id}:${template.key}`;
      const excerpt = template.text(company.name);
      await client.query(
        `INSERT INTO research_evidence (
          id, company_id, source_kind, source_document_id, source_passage_id, source_type,
          document_title, document_date, section_title, topic, excerpt, source_url,
          source_quality, content_hash, review_status, review_note, reviewed_at,
          evidence_quality_score, materiality_score, specificity_score, relevance_score,
          boilerplate_risk, quality_reasons, duplicate_count, suggestion_status, quality_scored_at
        ) VALUES (
          $1, $2, 'ir', $3, $4, 'Investor update', $5, $6, 'Operating update', $7, $8, $9,
          90, $10, 'accepted', 'Deterministic CI fixture', now(), 88, 90, 86, 92, 5,
          $11::jsonb, 1, 'pending', now()
        )`,
        [
          id,
          company.id,
          `e2e-document:${company.id}:${template.key}`,
          `e2e-passage:${company.id}:${template.key}`,
          template.title,
          template.date,
          template.topic,
          excerpt,
          `https://example.com/${company.id}/${template.key}`,
          createHash("sha256").update(excerpt).digest("hex"),
          JSON.stringify(["Official company source", "Specific infrastructure disclosure", "Material investor evidence"]),
        ],
      );
    }

    const reviewExcerpt = `${company.name} deployed 10,000 current-generation GPUs during the quarter and expects utilization to ramp as customer clusters enter production.`;
    await client.query(
      `INSERT INTO research_evidence (
        id, company_id, source_kind, source_document_id, source_passage_id, source_type,
        document_title, document_date, section_title, topic, excerpt, source_url,
        source_quality, content_hash, review_status, evidence_quality_score, materiality_score,
        specificity_score, relevance_score, boilerplate_risk, quality_reasons, duplicate_count,
        suggested_claim_id, suggested_impact, suggestion_confidence, suggestion_rationale,
        suggestion_status, quality_scored_at
      ) VALUES (
        $1, $2, 'ir', $3, $4, 'Investor presentation', 'Q1 2026 GPU Deployment', '2026-03-31',
        'Compute fleet', 'Compute & accelerators', $5, $6, 90, $7, 'unreviewed', 82, 84, 90, 94, 4,
        $8::jsonb, 1, $9, 'supports', 91, 'The disclosure directly supports the tracked capacity-growth claim.', 'pending', now()
      )`,
      [
        `e2e:${company.id}:review`,
        company.id,
        `e2e-document:${company.id}:review`,
        `e2e-passage:${company.id}:review`,
        reviewExcerpt,
        `https://example.com/${company.id}/gpu-deployment`,
        createHash("sha256").update(reviewExcerpt).digest("hex"),
        JSON.stringify(["Official company source", "Explicit GPU count", "Analyst review required"]),
        claimId,
      ],
    );
  }

  await client.query("COMMIT");
  console.log(`Seeded ${secCompanies.length} companies and ${secCompanies.length * 4} evidence records for end-to-end tests.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}
