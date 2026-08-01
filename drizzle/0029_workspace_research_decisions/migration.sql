CREATE TABLE IF NOT EXISTS workspace_evidence_reviews (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  evidence_id text NOT NULL REFERENCES research_evidence(id) ON DELETE CASCADE,
  review_status text DEFAULT 'unreviewed' NOT NULL CHECK (review_status IN ('unreviewed', 'accepted', 'rejected')),
  review_note text,
  suggestion_status text DEFAULT 'pending' NOT NULL CHECK (suggestion_status IN ('pending', 'accepted', 'rejected')),
  suggested_claim_id text REFERENCES research_claims(id) ON DELETE SET NULL,
  suggested_impact text CHECK (suggested_impact IS NULL OR suggested_impact IN ('supports', 'weakens', 'watch')),
  reviewed_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT workspace_evidence_reviews_scope_unique UNIQUE (workspace_id, evidence_id)
);
CREATE INDEX IF NOT EXISTS workspace_evidence_reviews_status_idx ON workspace_evidence_reviews(workspace_id, review_status);

INSERT INTO workspace_evidence_reviews (
  id, workspace_id, evidence_id, review_status, review_note, suggestion_status,
  suggested_claim_id, suggested_impact, reviewed_by_user_id, reviewed_at
)
SELECT workspace.id || ':evidence-review:' || md5(evidence.id), workspace.id, evidence.id,
       evidence.review_status, evidence.review_note, evidence.suggestion_status,
       evidence.suggested_claim_id, evidence.suggested_impact,
       evidence.reviewed_by_user_id, evidence.reviewed_at
FROM workspaces workspace
CROSS JOIN research_evidence evidence
WHERE evidence.review_status <> 'unreviewed' OR evidence.suggestion_status <> 'pending'
ON CONFLICT (workspace_id, evidence_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_metric_reviews (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_id text NOT NULL REFERENCES company_metrics(id) ON DELETE CASCADE,
  review_status text DEFAULT 'proposed' NOT NULL CHECK (review_status IN ('proposed', 'accepted', 'rejected')),
  review_note text,
  reviewed_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT workspace_metric_reviews_scope_unique UNIQUE (workspace_id, metric_id)
);
CREATE INDEX IF NOT EXISTS workspace_metric_reviews_status_idx ON workspace_metric_reviews(workspace_id, review_status);

INSERT INTO workspace_metric_reviews (
  id, workspace_id, metric_id, review_status, review_note, reviewed_by_user_id, reviewed_at
)
SELECT workspace.id || ':metric-review:' || md5(metric.id), workspace.id, metric.id,
       metric.review_status, metric.review_note, metric.reviewed_by_user_id, metric.reviewed_at
FROM workspaces workspace
CROSS JOIN company_metrics metric
WHERE metric.review_status <> 'proposed' OR metric.reviewed_at IS NOT NULL
ON CONFLICT (workspace_id, metric_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_canonical_metrics (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id text NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
  metric_key text NOT NULL,
  scope_type text DEFAULT 'company' NOT NULL,
  period_type text DEFAULT 'instant' NOT NULL,
  metric_id text NOT NULL REFERENCES company_metrics(id) ON DELETE CASCADE,
  resolution_method text DEFAULT 'analyst_review' NOT NULL,
  rationale text,
  selected_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  selected_at timestamp with time zone DEFAULT now() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT workspace_canonical_metrics_scope_unique UNIQUE (workspace_id, period_id, metric_key, scope_type, period_type),
  CONSTRAINT workspace_canonical_metrics_metric_unique UNIQUE (workspace_id, metric_id)
);
CREATE INDEX IF NOT EXISTS workspace_canonical_metrics_company_key_idx ON workspace_canonical_metrics(workspace_id, company_id, metric_key);

ALTER TABLE earnings_change_briefs ADD COLUMN IF NOT EXISTS readiness_status text DEFAULT 'ready' NOT NULL;
ALTER TABLE earnings_change_brief_versions ADD COLUMN IF NOT EXISTS readiness_status text DEFAULT 'ready' NOT NULL;
UPDATE earnings_change_briefs
SET readiness_status = 'insufficient_evidence', thesis_impact = 'not_assessed'
WHERE change_count = 0;
UPDATE earnings_change_brief_versions
SET readiness_status = CASE WHEN COALESCE((snapshot ->> 'changeCount')::integer, 0) = 0 THEN 'insufficient_evidence' ELSE 'ready' END,
    thesis_impact = CASE WHEN COALESCE((snapshot ->> 'changeCount')::integer, 0) = 0 THEN 'not_assessed' ELSE thesis_impact END;

INSERT INTO workspace_canonical_metrics (
  id, workspace_id, company_id, period_id, metric_key, scope_type, period_type,
  metric_id, resolution_method, rationale, selected_by_user_id, selected_at
)
SELECT workspace.id || ':canonical:' || md5(canonical.metric_id), workspace.id,
       canonical.company_id, canonical.period_id, canonical.metric_key,
       canonical.scope_type, canonical.period_type, canonical.metric_id,
       canonical.resolution_method, canonical.rationale,
       canonical.selected_by_user_id, canonical.selected_at
FROM workspaces workspace
CROSS JOIN canonical_metrics canonical
ON CONFLICT (workspace_id, period_id, metric_key, scope_type, period_type) DO NOTHING;
