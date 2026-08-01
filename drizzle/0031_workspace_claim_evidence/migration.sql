ALTER TABLE research_alerts ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS research_alerts_claim_evidence_unique;
CREATE UNIQUE INDEX IF NOT EXISTS research_alerts_workspace_claim_evidence_unique
  ON research_alerts(workspace_id, claim_id, research_evidence_id);
CREATE INDEX IF NOT EXISTS research_alerts_workspace_idx ON research_alerts(workspace_id);

CREATE TABLE IF NOT EXISTS workspace_claim_evidence (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  claim_id text NOT NULL REFERENCES research_claims(id) ON DELETE CASCADE,
  research_evidence_id text NOT NULL REFERENCES research_evidence(id) ON DELETE CASCADE,
  impact text NOT NULL,
  impact_score integer NOT NULL,
  rationale text NOT NULL,
  created_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_claim_evidence_scope_unique
  ON workspace_claim_evidence(workspace_id, claim_id, research_evidence_id);
CREATE INDEX IF NOT EXISTS workspace_claim_evidence_claim_idx
  ON workspace_claim_evidence(workspace_id, claim_id);

INSERT INTO workspace_claim_evidence (
  id, workspace_id, claim_id, research_evidence_id, impact, impact_score, rationale,
  created_by_user_id, created_at, updated_at
)
SELECT
  wer.workspace_id || ':claim-evidence:' || md5(ce.claim_id || ':' || ce.research_evidence_id),
  wer.workspace_id, ce.claim_id, ce.research_evidence_id, ce.impact, ce.impact_score, ce.rationale,
  wer.reviewed_by_user_id, ce.created_at, now()
FROM claim_evidence ce
JOIN workspace_evidence_reviews wer ON wer.evidence_id = ce.research_evidence_id
WHERE ce.research_evidence_id IS NOT NULL
  AND wer.review_status = 'accepted'
  AND wer.suggestion_status = 'accepted'
  AND wer.suggested_claim_id = ce.claim_id
ON CONFLICT (workspace_id, claim_id, research_evidence_id) DO NOTHING;

INSERT INTO research_alerts (
  id, workspace_id, company_id, claim_id, research_evidence_id, alert_type, category,
  significance, impact, title, summary, status, created_at, updated_at
)
SELECT
  'workspace-claim-alert:' || md5(wer.workspace_id || ':' || ra.claim_id || ':' || ra.research_evidence_id),
  wer.workspace_id, ra.company_id, ra.claim_id, ra.research_evidence_id, ra.alert_type,
  ra.category, ra.significance, ra.impact, ra.title, ra.summary, ra.status, ra.created_at, now()
FROM research_alerts ra
JOIN workspace_evidence_reviews wer ON wer.evidence_id = ra.research_evidence_id
WHERE ra.alert_type = 'claim_impact'
  AND ra.workspace_id IS NULL
  AND wer.review_status = 'accepted'
  AND wer.suggestion_status = 'accepted'
  AND wer.suggested_claim_id = ra.claim_id
ON CONFLICT (workspace_id, claim_id, research_evidence_id) DO NOTHING;

DELETE FROM research_alerts WHERE alert_type = 'claim_impact' AND workspace_id IS NULL;
DELETE FROM claim_evidence WHERE research_evidence_id IS NOT NULL;
