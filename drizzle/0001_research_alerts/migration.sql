CREATE TABLE "research_claims" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "theme" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "statement" text NOT NULL,
  "support_score" integer DEFAULT 50 NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "research_claims_company_kind_unique" ON "research_claims" USING btree ("company_id", "kind");
CREATE INDEX "research_claims_theme_idx" ON "research_claims" USING btree ("theme");

CREATE TABLE "claim_evidence" (
  "id" text PRIMARY KEY NOT NULL,
  "claim_id" text NOT NULL REFERENCES "research_claims"("id") ON DELETE cascade,
  "filing_change_id" text NOT NULL REFERENCES "filing_changes"("id") ON DELETE cascade,
  "impact" text NOT NULL,
  "impact_score" integer NOT NULL,
  "rationale" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "claim_evidence_claim_change_unique" ON "claim_evidence" USING btree ("claim_id", "filing_change_id");
CREATE INDEX "claim_evidence_claim_idx" ON "claim_evidence" USING btree ("claim_id");

CREATE TABLE "research_alerts" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "filing_id" text NOT NULL REFERENCES "filings"("id") ON DELETE cascade,
  "filing_change_id" text NOT NULL REFERENCES "filing_changes"("id") ON DELETE cascade,
  "category" text NOT NULL,
  "significance" text NOT NULL,
  "impact" text NOT NULL,
  "title" text NOT NULL,
  "summary" text NOT NULL,
  "status" text DEFAULT 'unread' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "research_alerts_change_unique" ON "research_alerts" USING btree ("filing_change_id");
CREATE INDEX "research_alerts_status_significance_idx" ON "research_alerts" USING btree ("status", "significance");
CREATE INDEX "research_alerts_company_idx" ON "research_alerts" USING btree ("company_id");

CREATE TABLE "thesis_snapshots" (
  "id" text PRIMARY KEY NOT NULL,
  "claim_id" text NOT NULL REFERENCES "research_claims"("id") ON DELETE cascade,
  "snapshot_date" date NOT NULL,
  "support_score" integer NOT NULL,
  "evidence_count" integer NOT NULL,
  "supporting_count" integer NOT NULL,
  "weakening_count" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "thesis_snapshots_claim_date_unique" ON "thesis_snapshots" USING btree ("claim_id", "snapshot_date");
CREATE INDEX "thesis_snapshots_claim_idx" ON "thesis_snapshots" USING btree ("claim_id");
