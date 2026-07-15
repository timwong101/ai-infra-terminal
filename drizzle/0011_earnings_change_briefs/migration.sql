CREATE TABLE IF NOT EXISTS "earnings_change_briefs" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "current_period_id" text NOT NULL REFERENCES "reporting_periods"("id") ON DELETE CASCADE,
  "previous_period_id" text REFERENCES "reporting_periods"("id") ON DELETE CASCADE,
  "headline" text NOT NULL,
  "summary" text NOT NULL,
  "thesis_impact" text NOT NULL,
  "confidence_score" integer NOT NULL,
  "evidence_quality_score" integer NOT NULL,
  "source_diversity_score" integer NOT NULL,
  "change_count" integer NOT NULL,
  "engine" text DEFAULT 'deterministic-v1' NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "earnings_change_briefs_period_pair_unique"
  ON "earnings_change_briefs" ("current_period_id", "previous_period_id");
CREATE INDEX IF NOT EXISTS "earnings_change_briefs_company_period_idx"
  ON "earnings_change_briefs" ("company_id", "current_period_id");

CREATE TABLE IF NOT EXISTS "earnings_change_brief_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "brief_id" text NOT NULL REFERENCES "earnings_change_briefs"("id") ON DELETE CASCADE,
  "ordinal" integer NOT NULL,
  "section" text NOT NULL,
  "title" text NOT NULL,
  "text" text NOT NULL,
  "sentiment" text NOT NULL,
  "significance" text NOT NULL,
  "comparison_id" text REFERENCES "period_comparisons"("id") ON DELETE SET NULL,
  "evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "earnings_change_brief_claims_ordinal_unique"
  ON "earnings_change_brief_claims" ("brief_id", "ordinal");
CREATE INDEX IF NOT EXISTS "earnings_change_brief_claims_brief_section_idx"
  ON "earnings_change_brief_claims" ("brief_id", "section");
