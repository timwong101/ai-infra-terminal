DO $$
DECLARE
  legacy_sessions text := 'research_' || 'co' || 'pilot_sessions';
  legacy_messages text := 'research_' || 'co' || 'pilot_messages';
BEGIN
  IF to_regclass('public.research_assistant_sessions') IS NULL
     AND to_regclass('public.' || legacy_sessions) IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I RENAME TO research_assistant_sessions', legacy_sessions);
  END IF;

  IF to_regclass('public.research_assistant_messages') IS NULL
     AND to_regclass('public.' || legacy_messages) IS NOT NULL THEN
    EXECUTE format('ALTER TABLE %I RENAME TO research_assistant_messages', legacy_messages);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS research_assistant_sessions (
  id text PRIMARY KEY,
  title text NOT NULL,
  company_ids jsonb DEFAULT '[]'::jsonb NOT NULL,
  topic text DEFAULT 'All topics' NOT NULL,
  source_kinds jsonb DEFAULT '[]'::jsonb NOT NULL,
  date_from date,
  date_to date,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS research_assistant_messages (
  id text PRIMARY KEY,
  session_id text NOT NULL,
  question text NOT NULL,
  answer_markdown text,
  claims jsonb DEFAULT '[]'::jsonb NOT NULL,
  open_questions jsonb DEFAULT '[]'::jsonb NOT NULL,
  confidence_score integer,
  evidence_quality_score integer,
  source_diversity_score integer,
  engine text NOT NULL,
  model text NOT NULL,
  retrieval_mode text DEFAULT 'pending' NOT NULL,
  status text DEFAULT 'running' NOT NULL,
  filters jsonb NOT NULL,
  evidence_snapshot jsonb DEFAULT '[]'::jsonb NOT NULL,
  verification jsonb,
  input_tokens integer,
  output_tokens integer,
  total_tokens integer,
  error text,
  started_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
DECLARE
  legacy_prefix text := 'research_' || 'co' || 'pilot';
  legacy_session_id_prefix text := 'co' || 'pilot:';
  legacy_message_id_prefix text := 'co' || 'pilot-message:';
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'research_assistant_messages'::regclass
      AND contype = 'f'
      AND confrelid = 'research_assistant_sessions'::regclass
  LOOP
    EXECUTE format('ALTER TABLE research_assistant_messages DROP CONSTRAINT %I', constraint_name);
  END LOOP;

  UPDATE research_assistant_sessions
  SET id = replace(id, legacy_session_id_prefix, 'research-assistant:')
  WHERE id LIKE legacy_session_id_prefix || '%';

  UPDATE research_assistant_messages
  SET session_id = replace(session_id, legacy_session_id_prefix, 'research-assistant:'),
      id = replace(id, legacy_message_id_prefix, 'research-assistant-message:')
  WHERE session_id LIKE legacy_session_id_prefix || '%'
     OR id LIKE legacy_message_id_prefix || '%';

  IF to_regclass('public.' || legacy_prefix || '_sessions_pkey') IS NOT NULL THEN
    EXECUTE format('ALTER INDEX %I RENAME TO research_assistant_sessions_pkey', legacy_prefix || '_sessions_pkey');
  END IF;
  IF to_regclass('public.' || legacy_prefix || '_sessions_updated_idx') IS NOT NULL THEN
    EXECUTE format('ALTER INDEX %I RENAME TO research_assistant_sessions_updated_idx', legacy_prefix || '_sessions_updated_idx');
  END IF;
  IF to_regclass('public.' || legacy_prefix || '_messages_pkey') IS NOT NULL THEN
    EXECUTE format('ALTER INDEX %I RENAME TO research_assistant_messages_pkey', legacy_prefix || '_messages_pkey');
  END IF;
  IF to_regclass('public.' || legacy_prefix || '_messages_session_idx') IS NOT NULL THEN
    EXECUTE format('ALTER INDEX %I RENAME TO research_assistant_messages_session_idx', legacy_prefix || '_messages_session_idx');
  END IF;
  IF to_regclass('public.' || legacy_prefix || '_messages_status_idx') IS NOT NULL THEN
    EXECUTE format('ALTER INDEX %I RENAME TO research_assistant_messages_status_idx', legacy_prefix || '_messages_status_idx');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS research_assistant_sessions_updated_idx ON research_assistant_sessions (updated_at);
CREATE INDEX IF NOT EXISTS research_assistant_messages_session_idx ON research_assistant_messages (session_id, created_at);
CREATE INDEX IF NOT EXISTS research_assistant_messages_status_idx ON research_assistant_messages (status, created_at);

ALTER TABLE research_assistant_messages
  ADD CONSTRAINT research_assistant_messages_session_id_fkey
  FOREIGN KEY (session_id) REFERENCES research_assistant_sessions(id) ON DELETE CASCADE;

DELETE FROM app_schema_migrations
WHERE id IN ('0015_research_' || 'co' || 'pilot', '0016_rename_research_assistant');
