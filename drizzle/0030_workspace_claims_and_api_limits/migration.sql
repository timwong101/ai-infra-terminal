CREATE TABLE IF NOT EXISTS api_rate_limits (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route text NOT NULL,
  window_start timestamp with time zone NOT NULL,
  request_count integer DEFAULT 1 NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS api_rate_limits_user_route_window_idx ON api_rate_limits(user_id, route, window_start);

CREATE TABLE IF NOT EXISTS workspace_claim_states (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  claim_id text NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
  title text,
  statement text,
  status text,
  support_score integer,
  is_stale boolean,
  stale_reason text,
  stale_at timestamp with time zone,
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT workspace_claim_states_scope_unique UNIQUE (workspace_id, claim_id)
);
CREATE INDEX IF NOT EXISTS workspace_claim_states_workspace_status_idx ON workspace_claim_states(workspace_id, status);

INSERT INTO workspace_claim_states (id, workspace_id, claim_id, title, statement, status, support_score, is_stale, stale_reason, stale_at, created_by_user_id)
SELECT audit.workspace_id || ':claim-state:' || claim.id, audit.workspace_id, claim.id,
       claim.title, claim.statement, claim.status, claim.support_score, claim.is_stale, claim.stale_reason, claim.stale_at, audit.actor_user_id
FROM research_claims claim
INNER JOIN LATERAL (
  SELECT workspace_id, actor_user_id
  FROM audit_events
  WHERE entity_type = 'research_claim' AND entity_id = claim.id AND action = 'thesis.created'
  ORDER BY created_at ASC
  LIMIT 1
) audit ON true
WHERE claim.kind LIKE 'custom:%'
ON CONFLICT (workspace_id, claim_id) DO NOTHING;
