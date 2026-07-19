CREATE TABLE IF NOT EXISTS research_quality_runs (
  id text PRIMARY KEY,
  suite_version text NOT NULL,
  engine text NOT NULL,
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

CREATE INDEX IF NOT EXISTS research_quality_runs_created_idx
  ON research_quality_runs (created_at);

CREATE TABLE IF NOT EXISTS research_quality_results (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES research_quality_runs(id) ON DELETE CASCADE,
  benchmark_id text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  question text NOT NULL,
  company_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  expectations jsonb DEFAULT '{}'::jsonb NOT NULL,
  status text NOT NULL,
  scores jsonb DEFAULT '{}'::jsonb NOT NULL,
  failure_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
  evidence_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
  claims jsonb DEFAULT '[]'::jsonb NOT NULL,
  retrieval_mode text NOT NULL,
  citation_count integer DEFAULT 0 NOT NULL,
  unsupported_claim_count integer DEFAULT 0 NOT NULL,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  estimated_cost_micros integer DEFAULT 0 NOT NULL,
  latency_ms integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS research_quality_results_run_benchmark_unique
  ON research_quality_results (run_id, benchmark_id);
CREATE INDEX IF NOT EXISTS research_quality_results_run_status_idx
  ON research_quality_results (run_id, status);
