CREATE TABLE IF NOT EXISTS company_commitments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_evidence_id text NOT NULL REFERENCES research_evidence(id) ON DELETE RESTRICT,
  commitment_key text NOT NULL,
  metric_key text NOT NULL,
  label text NOT NULL,
  category text NOT NULL,
  scope_type text DEFAULT 'company' NOT NULL,
  scope_label text DEFAULT 'Company total' NOT NULL,
  initial_statement text NOT NULL,
  review_status text DEFAULT 'proposed' NOT NULL,
  review_note text,
  reviewed_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT company_commitments_workspace_source_metric_unique UNIQUE (workspace_id, source_evidence_id, metric_key)
);
CREATE INDEX IF NOT EXISTS company_commitments_workspace_company_idx ON company_commitments(workspace_id, company_id, review_status);
CREATE INDEX IF NOT EXISTS company_commitments_identity_idx ON company_commitments(workspace_id, company_id, commitment_key);

CREATE TABLE IF NOT EXISTS commitment_revisions (
  id text PRIMARY KEY,
  commitment_id text NOT NULL REFERENCES company_commitments(id) ON DELETE CASCADE,
  source_evidence_id text NOT NULL REFERENCES research_evidence(id) ON DELETE RESTRICT,
  previous_revision_id text REFERENCES commitment_revisions(id) ON DELETE SET NULL,
  sequence integer NOT NULL,
  revision_kind text NOT NULL,
  statement text NOT NULL,
  target_value text NOT NULL,
  target_display text NOT NULL,
  target_unit text NOT NULL,
  target_period_end date,
  target_date_precision text DEFAULT 'undated' NOT NULL,
  confidence integer NOT NULL,
  valid_from date NOT NULL,
  review_status text DEFAULT 'proposed' NOT NULL,
  review_note text,
  reviewed_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT commitment_revisions_source_unique UNIQUE (commitment_id, source_evidence_id),
  CONSTRAINT commitment_revisions_sequence_unique UNIQUE (commitment_id, sequence)
);
CREATE INDEX IF NOT EXISTS commitment_revisions_commitment_recorded_idx ON commitment_revisions(commitment_id, recorded_at);

CREATE TABLE IF NOT EXISTS commitment_outcomes (
  id text PRIMARY KEY,
  commitment_id text NOT NULL REFERENCES company_commitments(id) ON DELETE CASCADE,
  metric_id text REFERENCES company_metrics(id) ON DELETE SET NULL,
  source_evidence_id text REFERENCES research_evidence(id) ON DELETE SET NULL,
  outcome_status text NOT NULL,
  actual_value text,
  actual_display text,
  actual_unit text,
  actual_period_end date,
  variance_percent integer,
  rationale text NOT NULL,
  confidence integer NOT NULL,
  reviewed_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT commitment_outcomes_metric_unique UNIQUE (commitment_id, metric_id)
);
CREATE INDEX IF NOT EXISTS commitment_outcomes_commitment_recorded_idx ON commitment_outcomes(commitment_id, recorded_at);
