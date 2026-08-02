WITH ranked_current AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY source_kind, source_document_id
    ORDER BY fetched_at DESC, created_at DESC, id DESC
  ) AS position
  FROM source_document_versions
  WHERE is_current = true
)
UPDATE source_document_versions
SET is_current = false
WHERE id IN (SELECT id FROM ranked_current WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS source_document_versions_one_current_unique
  ON source_document_versions (source_kind, source_document_id)
  WHERE is_current = true;

WITH ranked_promoted AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY source_kind, source_document_id
    ORDER BY promoted_at DESC NULLS LAST, completed_at DESC NULLS LAST, started_at DESC, id DESC
  ) AS position
  FROM source_extraction_runs
  WHERE status = 'promoted'
)
UPDATE source_extraction_runs
SET status = 'superseded'
WHERE id IN (SELECT id FROM ranked_promoted WHERE position > 1);

CREATE UNIQUE INDEX IF NOT EXISTS source_extraction_runs_one_promoted_unique
  ON source_extraction_runs (source_kind, source_document_id)
  WHERE status = 'promoted';

UPDATE workspace_evidence_reviews
SET review_status = 'unreviewed',
    review_note = 'Machine-prioritized candidate; analyst review required.',
    reviewed_by_user_id = NULL,
    reviewed_at = NULL,
    updated_at = NOW()
WHERE review_note LIKE 'System baseline:%';

ALTER TABLE comparison_memos
  ADD COLUMN IF NOT EXISTS generation_policy_version TEXT NOT NULL DEFAULT 'memo-grounding-v1';

ALTER TABLE memo_generations
  ADD COLUMN IF NOT EXISTS policy_version TEXT NOT NULL DEFAULT 'memo-grounding-v1';
