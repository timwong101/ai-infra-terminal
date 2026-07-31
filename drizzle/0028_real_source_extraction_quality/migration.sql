CREATE TABLE IF NOT EXISTS extraction_benchmark_cases (
  id text PRIMARY KEY,
  suite_version text NOT NULL,
  case_version integer DEFAULT 1 NOT NULL,
  title text NOT NULL,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_document_id text NOT NULL,
  origin text DEFAULT 'curated-real-source' NOT NULL,
  severity text DEFAULT 'high' NOT NULL,
  expectations jsonb DEFAULT '{}'::jsonb NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT extraction_benchmark_cases_source_unique UNIQUE (source_kind, source_document_id)
);
CREATE INDEX IF NOT EXISTS extraction_benchmark_cases_company_active_idx ON extraction_benchmark_cases(company_id, active);

CREATE TABLE IF NOT EXISTS extraction_quality_runs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  suite_version text NOT NULL,
  parser_version text NOT NULL,
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
  completed_at timestamp with time zone
);
CREATE INDEX IF NOT EXISTS extraction_quality_runs_workspace_started_idx ON extraction_quality_runs(workspace_id, started_at);

CREATE TABLE IF NOT EXISTS extraction_quality_results (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES extraction_quality_runs(id) ON DELETE CASCADE,
  benchmark_id text NOT NULL REFERENCES extraction_benchmark_cases(id) ON DELETE RESTRICT,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_document_id text NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  artifact_hash text,
  extraction_run_id text REFERENCES source_extraction_runs(id) ON DELETE SET NULL,
  scores jsonb DEFAULT '{}'::jsonb NOT NULL,
  expected jsonb DEFAULT '{}'::jsonb NOT NULL,
  actual jsonb DEFAULT '{}'::jsonb NOT NULL,
  failure_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
  duration_ms integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT extraction_quality_results_run_case_unique UNIQUE (run_id, benchmark_id)
);
CREATE INDEX IF NOT EXISTS extraction_quality_results_run_status_idx ON extraction_quality_results(run_id, status);

CREATE TABLE IF NOT EXISTS parser_releases (
  id text PRIMARY KEY,
  parser_version text NOT NULL,
  benchmark_run_id text NOT NULL REFERENCES extraction_quality_runs(id) ON DELETE RESTRICT,
  status text DEFAULT 'candidate' NOT NULL,
  quality_score integer NOT NULL,
  release_notes text NOT NULL,
  promoted_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  promoted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT parser_releases_run_unique UNIQUE (benchmark_run_id)
);
CREATE INDEX IF NOT EXISTS parser_releases_version_status_idx ON parser_releases(parser_version, status);
