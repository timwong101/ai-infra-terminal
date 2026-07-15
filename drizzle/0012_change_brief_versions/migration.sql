CREATE TABLE IF NOT EXISTS "earnings_change_brief_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL REFERENCES "companies"("id") ON DELETE CASCADE,
  "current_period_key" text NOT NULL,
  "current_period_label" text NOT NULL,
  "previous_period_key" text NOT NULL,
  "previous_period_label" text NOT NULL,
  "thesis_impact" text NOT NULL,
  "confidence_score" integer NOT NULL,
  "content_hash" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "earnings_change_brief_versions_content_unique"
  ON "earnings_change_brief_versions" ("company_id", "current_period_key", "previous_period_key", "content_hash");
CREATE INDEX IF NOT EXISTS "earnings_change_brief_versions_period_idx"
  ON "earnings_change_brief_versions" ("company_id", "current_period_key", "generated_at");
