ALTER TABLE research_evidence
  ADD COLUMN evidence_quality_score integer DEFAULT 0 NOT NULL,
  ADD COLUMN materiality_score integer DEFAULT 0 NOT NULL,
  ADD COLUMN specificity_score integer DEFAULT 0 NOT NULL,
  ADD COLUMN relevance_score integer DEFAULT 0 NOT NULL,
  ADD COLUMN boilerplate_risk integer DEFAULT 0 NOT NULL,
  ADD COLUMN quality_reasons jsonb DEFAULT '[]'::jsonb NOT NULL,
  ADD COLUMN duplicate_group_id text,
  ADD COLUMN duplicate_count integer DEFAULT 1 NOT NULL,
  ADD COLUMN suggested_claim_id text,
  ADD COLUMN suggested_impact text,
  ADD COLUMN suggestion_confidence integer DEFAULT 0 NOT NULL,
  ADD COLUMN suggestion_rationale text,
  ADD COLUMN suggestion_status text DEFAULT 'pending' NOT NULL,
  ADD COLUMN quality_scored_at timestamp with time zone;

ALTER TABLE research_claims
  ADD COLUMN is_stale boolean DEFAULT false NOT NULL,
  ADD COLUMN stale_reason text,
  ADD COLUMN stale_at timestamp with time zone;

ALTER TABLE comparison_memos
  ADD COLUMN is_stale boolean DEFAULT false NOT NULL,
  ADD COLUMN stale_reason text,
  ADD COLUMN stale_at timestamp with time zone;

CREATE INDEX research_evidence_quality_review_idx ON research_evidence (review_status, evidence_quality_score);
CREATE INDEX research_evidence_suggestion_idx ON research_evidence (suggestion_status, suggested_claim_id);
