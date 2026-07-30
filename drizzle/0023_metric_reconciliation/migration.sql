ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS scope_type text DEFAULT 'company' NOT NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS scope_label text;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS period_type text DEFAULT 'instant' NOT NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS period_start date;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS anomaly_flags jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS anomaly_score integer DEFAULT 0 NOT NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS extractor_version text DEFAULT 'metric-extractor-v2' NOT NULL;
ALTER TABLE company_metrics ADD COLUMN IF NOT EXISTS canonical_eligible boolean DEFAULT true NOT NULL;

UPDATE company_metrics
SET review_status = 'proposed', review_note = NULL
WHERE source_kind = 'text' AND review_status = 'accepted' AND reviewed_at IS NULL;

DELETE FROM research_alerts WHERE alert_type = 'metric_change';

CREATE INDEX IF NOT EXISTS company_metrics_anomaly_idx ON company_metrics(canonical_eligible, anomaly_score);

ALTER TABLE metric_conflicts ADD COLUMN IF NOT EXISTS scope_type text DEFAULT 'company' NOT NULL;
ALTER TABLE metric_conflicts ADD COLUMN IF NOT EXISTS period_type text DEFAULT 'instant' NOT NULL;
ALTER TABLE metric_conflicts DROP CONSTRAINT IF EXISTS metric_conflicts_period_key_unique;
DROP INDEX IF EXISTS metric_conflicts_period_key_unique;
CREATE UNIQUE INDEX IF NOT EXISTS metric_conflicts_period_key_scope_unique ON metric_conflicts(period_id, metric_key, scope_type, period_type);

CREATE TABLE IF NOT EXISTS canonical_metrics (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id text NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  scope_type text DEFAULT 'company' NOT NULL,
  period_type text DEFAULT 'instant' NOT NULL,
  metric_id text NOT NULL REFERENCES company_metrics(id) ON DELETE CASCADE,
  resolution_method text DEFAULT 'analyst_review' NOT NULL,
  rationale text,
  selected_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  selected_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT canonical_metrics_period_key_scope_unique UNIQUE (period_id, metric_key, scope_type, period_type),
  CONSTRAINT canonical_metrics_metric_unique UNIQUE (metric_id)
);
CREATE INDEX IF NOT EXISTS canonical_metrics_company_key_idx ON canonical_metrics(company_id, metric_key);

INSERT INTO canonical_metrics (id, company_id, period_id, metric_key, scope_type, period_type, metric_id, rationale, selected_by_user_id, selected_at)
SELECT 'canonical:' || id, company_id, period_id, metric_key, scope_type, period_type, id,
       COALESCE(review_note, 'Migrated analyst-reviewed observation.'), reviewed_by_user_id, reviewed_at
FROM company_metrics
WHERE review_status = 'accepted' AND reviewed_at IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS metric_quality_runs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  suite_version text NOT NULL,
  status text DEFAULT 'running' NOT NULL,
  overall_score integer,
  pass_rate integer,
  metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
  case_count integer DEFAULT 0 NOT NULL,
  passed_count integer DEFAULT 0 NOT NULL,
  failed_count integer DEFAULT 0 NOT NULL,
  duration_ms integer,
  error text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS metric_quality_runs_workspace_created_idx ON metric_quality_runs(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS metric_quality_results (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES metric_quality_runs(id) ON DELETE CASCADE,
  benchmark_id text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  expected jsonb DEFAULT '{}'::jsonb NOT NULL,
  actual jsonb DEFAULT '{}'::jsonb NOT NULL,
  failure_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT metric_quality_results_run_benchmark_unique UNIQUE (run_id, benchmark_id)
);
CREATE INDEX IF NOT EXISTS metric_quality_results_run_status_idx ON metric_quality_results(run_id, status);
