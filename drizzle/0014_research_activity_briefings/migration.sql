CREATE TABLE research_cycle_events (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES research_cycle_runs(id) ON DELETE CASCADE,
  stage text NOT NULL,
  status text DEFAULT 'running' NOT NULL,
  attempt integer DEFAULT 1 NOT NULL,
  message text,
  metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX research_cycle_events_run_stage_idx
  ON research_cycle_events(run_id, stage, started_at DESC);

CREATE TABLE research_briefings (
  id text PRIMARY KEY,
  run_id text REFERENCES research_cycle_runs(id) ON DELETE SET NULL,
  title text NOT NULL,
  summary text NOT NULL,
  status text DEFAULT 'ready' NOT NULL,
  window_started_at timestamp with time zone NOT NULL,
  window_ended_at timestamp with time zone NOT NULL,
  stats jsonb DEFAULT '{}'::jsonb NOT NULL,
  sections jsonb DEFAULT '[]'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX research_briefings_created_idx ON research_briefings(created_at DESC);
CREATE INDEX research_briefings_run_idx ON research_briefings(run_id);
