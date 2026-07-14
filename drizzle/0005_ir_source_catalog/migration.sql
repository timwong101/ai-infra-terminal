CREATE TABLE IF NOT EXISTS ir_source_documents (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  published_at date NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  source_url text NOT NULL,
  source_page_url text NOT NULL,
  source_quality integer NOT NULL,
  relevance_score integer NOT NULL,
  signal text NOT NULL,
  extraction_status text DEFAULT 'pending' NOT NULL,
  attempts integer DEFAULT 0 NOT NULL,
  last_error text,
  discovered_at timestamp with time zone DEFAULT now() NOT NULL,
  last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
  last_attempted_at timestamp with time zone,
  completed_at timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS ir_source_documents_source_url_unique ON ir_source_documents(source_url);
CREATE INDEX IF NOT EXISTS ir_source_documents_status_date_idx ON ir_source_documents(extraction_status, published_at);
CREATE INDEX IF NOT EXISTS ir_source_documents_company_date_idx ON ir_source_documents(company_id, published_at);
