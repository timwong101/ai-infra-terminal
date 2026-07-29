ALTER TABLE research_cycle_runs ALTER COLUMN status SET DEFAULT 'queued';
ALTER TABLE research_cycle_runs ADD COLUMN IF NOT EXISTS queue_job_id text;
ALTER TABLE research_cycle_runs ADD COLUMN IF NOT EXISTS trace_id text;
ALTER TABLE research_cycle_runs ADD COLUMN IF NOT EXISTS requested_by_user_id text REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE research_cycle_runs ADD COLUMN IF NOT EXISTS worker_id text;
ALTER TABLE research_cycle_runs ADD COLUMN IF NOT EXISTS retry_of_run_id text REFERENCES research_cycle_runs(id) ON DELETE SET NULL;
ALTER TABLE research_cycle_runs ADD COLUMN IF NOT EXISTS progress integer DEFAULT 0 NOT NULL;
ALTER TABLE research_cycle_runs ADD COLUMN IF NOT EXISTS context jsonb DEFAULT '{}'::jsonb NOT NULL;
ALTER TABLE research_cycle_runs ADD COLUMN IF NOT EXISTS cancel_requested_at timestamp with time zone;
ALTER TABLE research_cycle_runs ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamp with time zone;

UPDATE research_cycle_runs SET progress = 100 WHERE status = 'completed' AND progress = 0;

ALTER TABLE research_cycle_events ADD COLUMN IF NOT EXISTS job_id text;
ALTER TABLE research_cycle_events ADD COLUMN IF NOT EXISTS max_attempts integer DEFAULT 3 NOT NULL;
ALTER TABLE research_cycle_events ADD COLUMN IF NOT EXISTS next_retry_at timestamp with time zone;

CREATE INDEX IF NOT EXISTS research_cycle_runs_trace_idx ON research_cycle_runs(trace_id);

CREATE TABLE IF NOT EXISTS research_workers (
  id text PRIMARY KEY,
  queue_name text NOT NULL,
  status text DEFAULT 'online' NOT NULL,
  current_run_id text REFERENCES research_cycle_runs(id) ON DELETE SET NULL,
  concurrency integer DEFAULT 1 NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  last_heartbeat_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS research_workers_heartbeat_idx ON research_workers(status, last_heartbeat_at);
