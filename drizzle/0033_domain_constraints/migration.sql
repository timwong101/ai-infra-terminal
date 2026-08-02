DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'research_cycle_runs'
      AND column_name = 'trace_id'
  ) THEN
    ALTER TABLE research_cycle_runs RENAME COLUMN trace_id TO correlation_id;
  END IF;
END $$;
DROP INDEX IF EXISTS research_cycle_runs_trace_idx;
CREATE INDEX IF NOT EXISTS research_cycle_runs_correlation_idx ON research_cycle_runs(correlation_id);

ALTER TABLE workspace_members
  DROP CONSTRAINT IF EXISTS workspace_members_role_check,
  ADD CONSTRAINT workspace_members_role_check CHECK (role IN ('viewer', 'analyst', 'admin')) NOT VALID;
ALTER TABLE workspace_members VALIDATE CONSTRAINT workspace_members_role_check;

ALTER TABLE workspace_invitations
  DROP CONSTRAINT IF EXISTS workspace_invitations_role_check,
  DROP CONSTRAINT IF EXISTS workspace_invitations_status_check,
  ADD CONSTRAINT workspace_invitations_role_check CHECK (role IN ('viewer', 'analyst', 'admin')) NOT VALID,
  ADD CONSTRAINT workspace_invitations_status_check CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')) NOT VALID;
ALTER TABLE workspace_invitations VALIDATE CONSTRAINT workspace_invitations_role_check;
ALTER TABLE workspace_invitations VALIDATE CONSTRAINT workspace_invitations_status_check;

ALTER TABLE workspace_evidence_reviews
  DROP CONSTRAINT IF EXISTS workspace_evidence_reviews_status_check,
  ADD CONSTRAINT workspace_evidence_reviews_status_check CHECK (review_status IN ('unreviewed', 'accepted', 'rejected')) NOT VALID;
ALTER TABLE workspace_evidence_reviews VALIDATE CONSTRAINT workspace_evidence_reviews_status_check;

ALTER TABLE workspace_claim_states
  DROP CONSTRAINT IF EXISTS workspace_claim_states_status_check,
  ADD CONSTRAINT workspace_claim_states_status_check CHECK (status IS NULL OR status IN ('active', 'watch', 'retired')) NOT VALID;
ALTER TABLE workspace_claim_states VALIDATE CONSTRAINT workspace_claim_states_status_check;

ALTER TABLE user_alert_states
  DROP CONSTRAINT IF EXISTS user_alert_states_status_check,
  ADD CONSTRAINT user_alert_states_status_check CHECK (status IN ('unread', 'read', 'archived')) NOT VALID;
ALTER TABLE user_alert_states VALIDATE CONSTRAINT user_alert_states_status_check;

ALTER TABLE comparison_memos
  DROP CONSTRAINT IF EXISTS comparison_memos_status_check,
  ADD CONSTRAINT comparison_memos_status_check CHECK (status IN ('draft', 'in_review', 'approved', 'changes_requested', 'stale', 'published')) NOT VALID;
ALTER TABLE comparison_memos VALIDATE CONSTRAINT comparison_memos_status_check;

ALTER TABLE research_quality_runs
  DROP CONSTRAINT IF EXISTS research_quality_runs_status_check,
  ADD CONSTRAINT research_quality_runs_status_check CHECK (status IN ('running', 'completed', 'error')) NOT VALID;
ALTER TABLE research_quality_runs VALIDATE CONSTRAINT research_quality_runs_status_check;

ALTER TABLE research_cycle_runs
  DROP CONSTRAINT IF EXISTS research_cycle_runs_status_check,
  ADD CONSTRAINT research_cycle_runs_status_check CHECK (status IN ('queued', 'running', 'cancelling', 'completed', 'failed', 'cancelled')) NOT VALID;
ALTER TABLE research_cycle_runs VALIDATE CONSTRAINT research_cycle_runs_status_check;

ALTER TABLE research_cycle_events
  DROP CONSTRAINT IF EXISTS research_cycle_events_status_check,
  ADD CONSTRAINT research_cycle_events_status_check CHECK (status IN ('queued', 'running', 'retrying', 'completed', 'failed', 'cancelled')) NOT VALID;
ALTER TABLE research_cycle_events VALIDATE CONSTRAINT research_cycle_events_status_check;

ALTER TABLE research_workers
  DROP CONSTRAINT IF EXISTS research_workers_status_check,
  ADD CONSTRAINT research_workers_status_check CHECK (status IN ('online', 'offline', 'draining')) NOT VALID;
ALTER TABLE research_workers VALIDATE CONSTRAINT research_workers_status_check;
