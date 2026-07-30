ALTER TABLE research_quality_feedback
ADD COLUMN IF NOT EXISTS adjudication_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL;
