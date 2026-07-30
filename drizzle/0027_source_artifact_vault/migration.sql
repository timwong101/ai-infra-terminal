CREATE TABLE IF NOT EXISTS source_artifacts (
  id text PRIMARY KEY,
  content_hash text NOT NULL UNIQUE,
  storage_key text NOT NULL UNIQUE,
  storage_backend text NOT NULL,
  storage_status text DEFAULT 'available' NOT NULL,
  content_type text NOT NULL,
  byte_length integer NOT NULL,
  verified_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS source_artifacts_status_created_idx ON source_artifacts(storage_status, created_at);

CREATE TABLE IF NOT EXISTS source_document_versions (
  id text PRIMARY KEY,
  artifact_id text NOT NULL REFERENCES source_artifacts(id) ON DELETE RESTRICT,
  source_kind text NOT NULL,
  source_document_id text NOT NULL,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  source_url text NOT NULL,
  etag text,
  last_modified text,
  is_current boolean DEFAULT true NOT NULL,
  fetched_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT source_document_versions_document_artifact_unique UNIQUE (source_kind, source_document_id, artifact_id)
);
CREATE INDEX IF NOT EXISTS source_document_versions_current_idx ON source_document_versions(source_kind, source_document_id, is_current);
CREATE INDEX IF NOT EXISTS source_document_versions_company_fetched_idx ON source_document_versions(company_id, fetched_at);

CREATE TABLE IF NOT EXISTS source_extraction_runs (
  id text PRIMARY KEY,
  source_version_id text NOT NULL REFERENCES source_document_versions(id) ON DELETE CASCADE,
  artifact_id text NOT NULL REFERENCES source_artifacts(id) ON DELETE RESTRICT,
  source_kind text NOT NULL,
  source_document_id text NOT NULL,
  run_kind text NOT NULL,
  parser_name text NOT NULL,
  parser_version text NOT NULL,
  code_version text NOT NULL,
  status text NOT NULL,
  input_hash text NOT NULL,
  output_hash text NOT NULL,
  output_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
  passage_count integer DEFAULT 0 NOT NULL,
  section_count integer DEFAULT 0 NOT NULL,
  diff_summary jsonb DEFAULT '{}'::jsonb NOT NULL,
  duration_ms integer DEFAULT 0 NOT NULL,
  error text,
  promoted_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  promoted_at timestamp with time zone,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone
);
CREATE UNIQUE INDEX IF NOT EXISTS source_extraction_runs_replay_unique ON source_extraction_runs(source_version_id, run_kind, parser_version, output_hash);
CREATE INDEX IF NOT EXISTS source_extraction_runs_document_status_idx ON source_extraction_runs(source_kind, source_document_id, status, started_at);
CREATE INDEX IF NOT EXISTS source_extraction_runs_artifact_idx ON source_extraction_runs(artifact_id);
