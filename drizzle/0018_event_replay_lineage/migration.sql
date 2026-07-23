CREATE TABLE IF NOT EXISTS live_events (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  theme text DEFAULT 'Neoclouds' NOT NULL,
  source_kind text NOT NULL CHECK (source_kind IN ('official-ir', 'gdelt')),
  source_name text NOT NULL,
  source_domain text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  source_url text NOT NULL,
  published_at timestamp with time zone NOT NULL,
  event_type text NOT NULL,
  materiality_score integer NOT NULL CHECK (materiality_score BETWEEN 0 AND 100),
  credibility_score integer NOT NULL CHECK (credibility_score BETWEEN 0 AND 100),
  evidence_status text DEFAULT 'discovery' NOT NULL CHECK (evidence_status IN ('discovery', 'official')),
  language text,
  source_country text,
  fingerprint text NOT NULL,
  raw jsonb DEFAULT '{}'::jsonb NOT NULL,
  discovered_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS live_events_fingerprint_unique ON live_events(fingerprint);
CREATE INDEX IF NOT EXISTS live_events_company_published_idx ON live_events(company_id, published_at DESC);
CREATE INDEX IF NOT EXISTS live_events_status_materiality_idx ON live_events(evidence_status, materiality_score DESC);

CREATE TABLE IF NOT EXISTS event_claim_impacts (
  id text PRIMARY KEY,
  event_id text NOT NULL REFERENCES live_events(id) ON DELETE CASCADE,
  claim_id text NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
  impact text NOT NULL CHECK (impact IN ('supports', 'weakens', 'watch')),
  impact_score integer NOT NULL,
  rationale text NOT NULL,
  status text DEFAULT 'proposed' NOT NULL CHECK (status IN ('proposed', 'accepted', 'rejected')),
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS event_claim_impacts_event_claim_unique ON event_claim_impacts(event_id, claim_id);
CREATE INDEX IF NOT EXISTS event_claim_impacts_claim_status_idx ON event_claim_impacts(claim_id, status);

ALTER TABLE research_alerts ADD COLUMN IF NOT EXISTS live_event_id text REFERENCES live_events(id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS research_alerts_live_event_unique ON research_alerts(live_event_id);

CREATE TABLE IF NOT EXISTS research_replay_runs (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  as_of_date date NOT NULL,
  mode text DEFAULT 'system-known' NOT NULL CHECK (mode IN ('system-known', 'publication-time')),
  company_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  topic text DEFAULT 'All topics' NOT NULL,
  question text NOT NULL,
  status text DEFAULT 'completed' NOT NULL CHECK (status IN ('completed', 'error')),
  summary text NOT NULL,
  historical_claims jsonb DEFAULT '[]'::jsonb NOT NULL,
  current_claims jsonb DEFAULT '[]'::jsonb NOT NULL,
  historical_evidence_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
  current_evidence_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
  added_evidence_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
  metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS research_replay_runs_workspace_created_idx ON research_replay_runs(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS research_replay_runs_as_of_idx ON research_replay_runs(as_of_date);
