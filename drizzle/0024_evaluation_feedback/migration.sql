ALTER TABLE research_assistant_messages ADD COLUMN IF NOT EXISTS prompt text;
ALTER TABLE research_assistant_messages ADD COLUMN IF NOT EXISTS prompt_version text DEFAULT 'research-assistant-v1' NOT NULL;
ALTER TABLE research_assistant_messages ADD COLUMN IF NOT EXISTS config_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE research_assistant_messages ADD COLUMN IF NOT EXISTS estimated_cost_micros integer DEFAULT 0 NOT NULL;
ALTER TABLE research_assistant_messages ADD COLUMN IF NOT EXISTS latency_ms integer;

ALTER TABLE research_quality_results ADD COLUMN IF NOT EXISTS case_origin text DEFAULT 'curated' NOT NULL;
ALTER TABLE research_quality_results ADD COLUMN IF NOT EXISTS case_version integer DEFAULT 1 NOT NULL;

CREATE TABLE IF NOT EXISTS research_quality_feedback (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  reporter_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_type text NOT NULL,
  source_entity_id text NOT NULL,
  source_message_id text REFERENCES research_assistant_messages(id) ON DELETE SET NULL,
  failure_type text NOT NULL,
  severity text DEFAULT 'medium' NOT NULL,
  summary text NOT NULL,
  expected_behavior text,
  status text DEFAULT 'open' NOT NULL,
  trace_snapshot jsonb NOT NULL,
  promoted_case_id text,
  adjudicated_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  adjudicated_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS research_quality_feedback_workspace_status_idx ON research_quality_feedback(workspace_id, status, created_at);
CREATE INDEX IF NOT EXISTS research_quality_feedback_source_idx ON research_quality_feedback(source_type, source_entity_id);

CREATE TABLE IF NOT EXISTS research_quality_cases (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_feedback_id text REFERENCES research_quality_feedback(id) ON DELETE SET NULL,
  stable_key text NOT NULL,
  title text NOT NULL,
  category text DEFAULT 'production-regression' NOT NULL,
  status text DEFAULT 'active' NOT NULL,
  current_version integer DEFAULT 1 NOT NULL,
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT research_quality_cases_workspace_key_unique UNIQUE (workspace_id, stable_key)
);
CREATE INDEX IF NOT EXISTS research_quality_cases_workspace_status_idx ON research_quality_cases(workspace_id, status, updated_at);

CREATE TABLE IF NOT EXISTS research_quality_case_versions (
  id text PRIMARY KEY,
  case_id text NOT NULL REFERENCES research_quality_cases(id) ON DELETE CASCADE,
  version integer NOT NULL,
  question text NOT NULL,
  filters jsonb NOT NULL,
  expectations jsonb NOT NULL,
  expected_evidence_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  trace_snapshot jsonb NOT NULL,
  change_note text,
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT research_quality_case_versions_case_version_unique UNIQUE (case_id, version)
);
CREATE INDEX IF NOT EXISTS research_quality_case_versions_case_created_idx ON research_quality_case_versions(case_id, created_at);
