CREATE TABLE IF NOT EXISTS research_copilot_sessions (
  id text PRIMARY KEY,
  title text NOT NULL,
  company_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  topic text DEFAULT 'All topics' NOT NULL,
  source_kinds jsonb DEFAULT '[]'::jsonb NOT NULL,
  date_from date,
  date_to date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS research_copilot_sessions_updated_idx ON research_copilot_sessions (updated_at);

CREATE TABLE IF NOT EXISTS research_copilot_messages (
  id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES research_copilot_sessions(id) ON DELETE CASCADE,
  question text NOT NULL,
  answer_markdown text,
  claims jsonb DEFAULT '[]'::jsonb NOT NULL,
  open_questions jsonb DEFAULT '[]'::jsonb NOT NULL,
  confidence_score integer,
  evidence_quality_score integer,
  source_diversity_score integer,
  engine text NOT NULL,
  model text NOT NULL,
  retrieval_mode text DEFAULT 'pending' NOT NULL,
  status text DEFAULT 'running' NOT NULL,
  filters jsonb NOT NULL,
  evidence_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
  verification jsonb,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  error text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS research_copilot_messages_session_idx ON research_copilot_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS research_copilot_messages_status_idx ON research_copilot_messages (status, created_at);
