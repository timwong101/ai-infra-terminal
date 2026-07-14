CREATE TABLE IF NOT EXISTS reporting_periods (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_key text NOT NULL,
  label text NOT NULL,
  calendar_year integer NOT NULL,
  calendar_quarter integer NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  latest_document_date date NOT NULL,
  evidence_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS reporting_periods_company_key_unique ON reporting_periods(company_id, period_key);
CREATE INDEX IF NOT EXISTS reporting_periods_company_date_idx ON reporting_periods(company_id, period_end DESC);

CREATE TABLE IF NOT EXISTS company_metrics (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id text NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
  source_evidence_id text NOT NULL REFERENCES research_evidence(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  label text NOT NULL,
  category text NOT NULL,
  normalized_value text NOT NULL,
  display_value text NOT NULL,
  unit text NOT NULL,
  context text NOT NULL,
  confidence integer NOT NULL,
  document_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS company_metrics_evidence_key_unique ON company_metrics(source_evidence_id, metric_key);
CREATE INDEX IF NOT EXISTS company_metrics_period_key_idx ON company_metrics(period_id, metric_key);

CREATE TABLE IF NOT EXISTS period_comparisons (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  current_period_id text NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
  previous_period_id text REFERENCES reporting_periods(id) ON DELETE CASCADE,
  current_metric_id text REFERENCES company_metrics(id) ON DELETE CASCADE,
  previous_metric_id text REFERENCES company_metrics(id) ON DELETE SET NULL,
  comparison_key text NOT NULL,
  comparison_kind text NOT NULL,
  category text NOT NULL,
  label text NOT NULL,
  direction text NOT NULL,
  significance text NOT NULL,
  current_value text,
  previous_value text,
  delta_percent integer,
  summary text NOT NULL,
  current_text text,
  previous_text text,
  evidence_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS period_comparisons_period_key_unique ON period_comparisons(current_period_id, comparison_key);
CREATE INDEX IF NOT EXISTS period_comparisons_company_period_idx ON period_comparisons(company_id, current_period_id);
