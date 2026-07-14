CREATE TABLE IF NOT EXISTS research_evidence (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_document_id text NOT NULL,
  source_passage_id text NOT NULL,
  source_type text NOT NULL,
  document_title text NOT NULL,
  document_date date NOT NULL,
  section_title text NOT NULL,
  topic text NOT NULL,
  excerpt text NOT NULL,
  source_url text NOT NULL,
  page_number integer,
  source_quality integer NOT NULL,
  content_hash text NOT NULL,
  review_status text DEFAULT 'unreviewed' NOT NULL,
  review_note text,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS research_evidence_source_passage_unique
  ON research_evidence(source_kind, source_passage_id);
CREATE INDEX IF NOT EXISTS research_evidence_company_date_idx
  ON research_evidence(company_id, document_date DESC);
CREATE INDEX IF NOT EXISTS research_evidence_review_topic_idx
  ON research_evidence(review_status, topic);

CREATE TABLE IF NOT EXISTS comparison_memos (
  id text PRIMARY KEY,
  title text NOT NULL,
  question text NOT NULL,
  company_a_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_b_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  topic text NOT NULL,
  confidence_score integer NOT NULL,
  evidence_quality_score integer NOT NULL,
  source_diversity_score integer NOT NULL,
  status text DEFAULT 'draft' NOT NULL,
  sections jsonb NOT NULL,
  evidence_snapshot jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS comparison_memos_company_pair_idx
  ON comparison_memos(company_a_id, company_b_id);
CREATE INDEX IF NOT EXISTS comparison_memos_updated_idx
  ON comparison_memos(updated_at DESC);
