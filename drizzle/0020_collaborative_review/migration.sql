CREATE TABLE IF NOT EXISTS workspace_invitations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text DEFAULT 'analyst' NOT NULL CHECK (role IN ('viewer', 'analyst', 'admin')),
  token_hash text NOT NULL,
  invited_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accepted_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamp with time zone NOT NULL,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_invitations_token_hash_unique ON workspace_invitations(token_hash);
CREATE INDEX IF NOT EXISTS workspace_invitations_workspace_status_idx ON workspace_invitations(workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_invitations_email_idx ON workspace_invitations(email);

CREATE TABLE IF NOT EXISTS memo_reviews (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memo_id text NOT NULL REFERENCES comparison_memos(id) ON DELETE CASCADE,
  submitted_by_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewer_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status text DEFAULT 'in_review' NOT NULL CHECK (status IN ('in_review', 'changes_requested', 'approved', 'cancelled')),
  memo_hash text NOT NULL,
  submission_note text,
  decision_note text,
  submitted_at timestamp with time zone DEFAULT now() NOT NULL,
  decided_at timestamp with time zone,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS memo_reviews_memo_submitted_idx ON memo_reviews(memo_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS memo_reviews_reviewer_status_idx ON memo_reviews(workspace_id, reviewer_user_id, status);

CREATE TABLE IF NOT EXISTS memo_review_comments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  memo_id text NOT NULL REFERENCES comparison_memos(id) ON DELETE CASCADE,
  review_id text NOT NULL REFERENCES memo_reviews(id) ON DELETE CASCADE,
  author_user_id text NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  claim_key text,
  body text NOT NULL,
  resolved_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  resolved_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS memo_review_comments_review_created_idx ON memo_review_comments(review_id, created_at);
CREATE INDEX IF NOT EXISTS memo_review_comments_claim_idx ON memo_review_comments(memo_id, claim_key);

ALTER TABLE published_reports ADD COLUMN IF NOT EXISTS review_snapshot jsonb;

INSERT INTO users (id, email, name, provider, provider_account_id)
VALUES ('user:demo-reviewer', 'reviewer@ai-infra.local', 'Demo Reviewer', 'demo', 'demo-reviewer')
ON CONFLICT (id) DO NOTHING;
INSERT INTO workspace_members (id, workspace_id, user_id, role)
VALUES ('membership:demo-reviewer', 'workspace:demo', 'user:demo-reviewer', 'analyst')
ON CONFLICT (workspace_id, user_id) DO NOTHING;
