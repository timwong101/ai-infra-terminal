CREATE TABLE IF NOT EXISTS published_reports (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memo_id text NOT NULL REFERENCES comparison_memos(id) ON DELETE RESTRICT,
  published_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  public_token text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title text NOT NULL,
  question text NOT NULL,
  topic text NOT NULL,
  as_of_date date NOT NULL,
  company_snapshot jsonb NOT NULL,
  confidence_score integer NOT NULL CHECK (confidence_score BETWEEN 0 AND 100),
  evidence_quality_score integer NOT NULL CHECK (evidence_quality_score BETWEEN 0 AND 100),
  source_diversity_score integer NOT NULL CHECK (source_diversity_score BETWEEN 0 AND 100),
  sections_snapshot jsonb NOT NULL,
  evidence_snapshot jsonb NOT NULL,
  generation_snapshot jsonb,
  compliance_mode boolean DEFAULT true NOT NULL,
  compliance_snapshot jsonb NOT NULL,
  publisher_snapshot jsonb NOT NULL,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS published_reports_public_token_unique
  ON published_reports(public_token);
CREATE UNIQUE INDEX IF NOT EXISTS published_reports_memo_version_unique
  ON published_reports(memo_id, version);
CREATE INDEX IF NOT EXISTS published_reports_workspace_created_idx
  ON published_reports(workspace_id, created_at DESC);
