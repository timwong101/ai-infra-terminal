ALTER TABLE research_briefings ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;

INSERT INTO research_briefings (
  id, workspace_id, run_id, title, summary, status, window_started_at,
  window_ended_at, stats, sections, created_at
)
SELECT
  briefing.id || ':' || md5(workspace.id), workspace.id, briefing.run_id,
  briefing.title, briefing.summary, briefing.status, briefing.window_started_at,
  briefing.window_ended_at, briefing.stats, briefing.sections, briefing.created_at
FROM research_briefings briefing
CROSS JOIN workspaces workspace
WHERE briefing.workspace_id IS NULL
ON CONFLICT (id) DO NOTHING;

DELETE FROM research_briefings WHERE workspace_id IS NULL;
ALTER TABLE research_briefings ALTER COLUMN workspace_id SET NOT NULL;

DROP INDEX IF EXISTS research_briefings_created_idx;
CREATE INDEX IF NOT EXISTS research_briefings_workspace_created_idx
  ON research_briefings(workspace_id, created_at);

CREATE INDEX IF NOT EXISTS research_quality_runs_workspace_created_idx
  ON research_quality_runs(workspace_id, created_at);
