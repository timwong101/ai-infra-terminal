CREATE TABLE "companies" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "ticker" text NOT NULL,
  "cik" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "companies_cik_unique" ON "companies" USING btree ("cik");

CREATE TABLE "filings" (
  "id" text PRIMARY KEY NOT NULL,
  "company_id" text NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "accession_number" text NOT NULL,
  "form_type" text NOT NULL,
  "filed_at" date NOT NULL,
  "source_url" text NOT NULL,
  "document_title" text NOT NULL,
  "word_count" integer NOT NULL,
  "extraction_quality" text NOT NULL,
  "extraction_message" text NOT NULL,
  "retrieved_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "filings_accession_unique" ON "filings" USING btree ("accession_number");
CREATE INDEX "filings_company_form_date_idx" ON "filings" USING btree ("company_id", "form_type", "filed_at");

CREATE TABLE "filing_sections" (
  "id" text PRIMARY KEY NOT NULL,
  "filing_id" text NOT NULL REFERENCES "filings"("id") ON DELETE cascade,
  "source_section_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "title" text NOT NULL,
  "category" text NOT NULL
);
CREATE UNIQUE INDEX "filing_sections_source_unique" ON "filing_sections" USING btree ("filing_id", "source_section_id");
CREATE INDEX "filing_sections_filing_idx" ON "filing_sections" USING btree ("filing_id");

CREATE TABLE "evidence_passages" (
  "id" text PRIMARY KEY NOT NULL,
  "section_id" text NOT NULL REFERENCES "filing_sections"("id") ON DELETE cascade,
  "source_passage_id" text NOT NULL,
  "ordinal" integer NOT NULL,
  "text" text NOT NULL,
  "word_count" integer NOT NULL
);
CREATE UNIQUE INDEX "evidence_passages_source_unique" ON "evidence_passages" USING btree ("section_id", "source_passage_id");
CREATE INDEX "evidence_passages_section_idx" ON "evidence_passages" USING btree ("section_id");

CREATE TABLE "filing_changes" (
  "id" text PRIMARY KEY NOT NULL,
  "current_filing_id" text NOT NULL REFERENCES "filings"("id") ON DELETE cascade,
  "previous_filing_id" text NOT NULL REFERENCES "filings"("id") ON DELETE cascade,
  "ordinal" integer NOT NULL,
  "change_type" text NOT NULL,
  "significance" text NOT NULL,
  "category" text NOT NULL,
  "section_title" text NOT NULL,
  "summary" text NOT NULL,
  "similarity" integer,
  "current_text" text,
  "previous_text" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX "filing_changes_pair_ordinal_unique" ON "filing_changes" USING btree ("current_filing_id", "previous_filing_id", "ordinal");
CREATE INDEX "filing_changes_current_idx" ON "filing_changes" USING btree ("current_filing_id");
