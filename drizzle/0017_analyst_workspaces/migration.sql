CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  avatar_url text,
  provider text NOT NULL,
  provider_account_id text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email);
CREATE UNIQUE INDEX IF NOT EXISTS users_provider_account_unique ON users(provider, provider_account_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  created_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_slug_unique ON workspaces(slug);

CREATE TABLE IF NOT EXISTS workspace_members (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text DEFAULT 'analyst' NOT NULL CHECK (role IN ('viewer', 'analyst', 'admin')),
  joined_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_workspace_user_unique ON workspace_members(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id text PRIMARY KEY,
  token_hash text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_sessions_token_hash_unique ON auth_sessions(token_hash);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expires_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_user_id text REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  summary text NOT NULL,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_workspace_created_idx ON audit_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS audit_events_actor_idx ON audit_events(actor_user_id, created_at);

INSERT INTO users (id, email, name, provider, provider_account_id)
VALUES ('user:demo', 'demo@ai-infra.local', 'Demo Analyst', 'demo', 'demo')
ON CONFLICT (id) DO NOTHING;
INSERT INTO workspaces (id, name, slug, created_by_user_id)
VALUES ('workspace:demo', 'Neocloud Research', 'neocloud-research', 'user:demo')
ON CONFLICT (id) DO NOTHING;
INSERT INTO workspace_members (id, workspace_id, user_id, role)
VALUES ('membership:demo', 'workspace:demo', 'user:demo', 'admin')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE research_evidence ADD COLUMN IF NOT EXISTS reviewed_by_user_id text REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE comparison_memos ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE comparison_memos ADD COLUMN IF NOT EXISTS owner_user_id text REFERENCES users(id) ON DELETE RESTRICT;
UPDATE comparison_memos SET workspace_id = 'workspace:demo', owner_user_id = 'user:demo' WHERE workspace_id IS NULL OR owner_user_id IS NULL;
ALTER TABLE comparison_memos ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE comparison_memos ALTER COLUMN owner_user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS comparison_memos_workspace_updated_idx ON comparison_memos(workspace_id, updated_at);

ALTER TABLE memo_generations ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE memo_generations ADD COLUMN IF NOT EXISTS owner_user_id text REFERENCES users(id) ON DELETE RESTRICT;
UPDATE memo_generations SET workspace_id = 'workspace:demo', owner_user_id = 'user:demo' WHERE workspace_id IS NULL OR owner_user_id IS NULL;
ALTER TABLE memo_generations ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE memo_generations ALTER COLUMN owner_user_id SET NOT NULL;

ALTER TABLE research_assistant_sessions ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE research_assistant_sessions ADD COLUMN IF NOT EXISTS owner_user_id text REFERENCES users(id) ON DELETE RESTRICT;
UPDATE research_assistant_sessions SET workspace_id = 'workspace:demo', owner_user_id = 'user:demo' WHERE workspace_id IS NULL OR owner_user_id IS NULL;
ALTER TABLE research_assistant_sessions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE research_assistant_sessions ALTER COLUMN owner_user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS research_assistant_sessions_workspace_updated_idx ON research_assistant_sessions(workspace_id, updated_at);

ALTER TABLE research_quality_runs ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE research_quality_runs ADD COLUMN IF NOT EXISTS owner_user_id text REFERENCES users(id) ON DELETE RESTRICT;
UPDATE research_quality_runs SET workspace_id = 'workspace:demo', owner_user_id = 'user:demo' WHERE workspace_id IS NULL OR owner_user_id IS NULL;
ALTER TABLE research_quality_runs ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE research_quality_runs ALTER COLUMN owner_user_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS research_quality_runs_workspace_created_idx ON research_quality_runs(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS user_alert_states (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id text NOT NULL REFERENCES research_alerts(id) ON DELETE CASCADE,
  status text DEFAULT 'unread' NOT NULL CHECK (status IN ('unread', 'reviewed', 'watching', 'dismissed')),
  reviewed_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS user_alert_states_scope_unique ON user_alert_states(workspace_id, user_id, alert_id);
CREATE INDEX IF NOT EXISTS user_alert_states_user_status_idx ON user_alert_states(workspace_id, user_id, status);
