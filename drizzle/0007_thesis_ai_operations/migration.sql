CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE claim_evidence ALTER COLUMN filing_change_id DROP NOT NULL;
ALTER TABLE claim_evidence ADD COLUMN IF NOT EXISTS research_evidence_id text;
ALTER TABLE claim_evidence
  ADD CONSTRAINT claim_evidence_research_evidence_fk
  FOREIGN KEY (research_evidence_id) REFERENCES research_evidence(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS claim_evidence_claim_research_unique
  ON claim_evidence(claim_id, research_evidence_id);

ALTER TABLE research_alerts ALTER COLUMN filing_id DROP NOT NULL;
ALTER TABLE research_alerts ALTER COLUMN filing_change_id DROP NOT NULL;
ALTER TABLE research_alerts ADD COLUMN IF NOT EXISTS claim_id text REFERENCES research_claims(id) ON DELETE CASCADE;
ALTER TABLE research_alerts ADD COLUMN IF NOT EXISTS research_evidence_id text REFERENCES research_evidence(id) ON DELETE CASCADE;
ALTER TABLE research_alerts ADD COLUMN IF NOT EXISTS alert_type text DEFAULT 'filing_change' NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS research_alerts_claim_evidence_unique
  ON research_alerts(claim_id, research_evidence_id);

ALTER TABLE research_evidence ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE research_evidence ADD COLUMN IF NOT EXISTS embedded_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS research_evidence_embedding_hnsw_idx
  ON research_evidence USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS research_evidence_excerpt_fts_idx
  ON research_evidence USING gin (to_tsvector('english', excerpt));

CREATE TABLE IF NOT EXISTS memo_generations (
  id text PRIMARY KEY,
  memo_id text REFERENCES comparison_memos(id) ON DELETE SET NULL,
  company_a_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  company_b_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  topic text NOT NULL,
  question text NOT NULL,
  prompt text NOT NULL,
  model text NOT NULL,
  engine text NOT NULL,
  retrieval_mode text NOT NULL,
  status text DEFAULT 'running' NOT NULL,
  output jsonb,
  evidence_snapshot jsonb NOT NULL,
  verification jsonb,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  error text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS memo_generations_status_idx ON memo_generations(status, created_at DESC);
CREATE INDEX IF NOT EXISTS memo_generations_pair_idx ON memo_generations(company_a_id, company_b_id);

CREATE TABLE IF NOT EXISTS research_cycle_runs (
  id text PRIMARY KEY,
  trigger text NOT NULL,
  status text DEFAULT 'running' NOT NULL,
  stage text DEFAULT 'starting' NOT NULL,
  metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
  error text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS research_cycle_runs_status_idx ON research_cycle_runs(status, started_at DESC);
