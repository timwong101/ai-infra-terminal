ALTER TABLE company_metrics ALTER COLUMN source_evidence_id DROP NOT NULL;
ALTER TABLE company_metrics DROP CONSTRAINT IF EXISTS company_metrics_source_evidence_id_research_evidence_id_fk;
ALTER TABLE company_metrics ADD CONSTRAINT company_metrics_source_evidence_id_research_evidence_id_fk FOREIGN KEY (source_evidence_id) REFERENCES research_evidence(id) ON DELETE SET NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS source_kind text DEFAULT 'text' NOT NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS source_document_id text;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS source_label text;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS taxonomy text;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS concept text;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS accession_number text;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS value_type text DEFAULT 'reported' NOT NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS measurement_type text DEFAULT 'instant' NOT NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS review_status text DEFAULT 'proposed' NOT NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS review_note text;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS reviewed_by_user_id text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS reviewed_at timestamp with time zone;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now() NOT NULL;

UPDATE company_metrics SET source_kind = 'text', review_status = 'accepted' WHERE source_kind = 'text';

CREATE INDEX IF NOT EXISTS company_metrics_review_idx ON company_metrics(review_status, metric_key);

CREATE TABLE IF NOT EXISTS metric_conflicts (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id text NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  metric_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  status text DEFAULT 'open' NOT NULL,
  resolved_metric_id text REFERENCES company_metrics(id) ON DELETE SET NULL,
  resolution_note text,
  resolved_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT metric_conflicts_period_key_unique UNIQUE (period_id, metric_key)
);

CREATE INDEX IF NOT EXISTS metric_conflicts_status_idx ON metric_conflicts(status, company_id);

ALTER TABLE comparison_memos ADD COLUMN IF NOT EXISTS metric_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE memo_generations ADD COLUMN IF NOT EXISTS metric_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE research_assistant_messages ADD COLUMN IF NOT EXISTS metric_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL;
