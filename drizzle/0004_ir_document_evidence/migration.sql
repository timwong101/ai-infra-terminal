CREATE TABLE IF NOT EXISTS ir_documents (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  document_type text NOT NULL,
  published_at date NOT NULL,
  title text NOT NULL,
  source_url text NOT NULL,
  source_page_url text NOT NULL,
  word_count integer NOT NULL,
  page_count integer,
  extraction_method text NOT NULL,
  extraction_quality text NOT NULL,
  extraction_message text NOT NULL,
  retrieved_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ir_documents_source_url_unique ON ir_documents(source_url);
CREATE INDEX IF NOT EXISTS ir_documents_company_type_date_idx ON ir_documents(company_id, document_type, published_at);

CREATE TABLE IF NOT EXISTS ir_document_sections (
  id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES ir_documents(id) ON DELETE CASCADE,
  source_section_id text NOT NULL,
  ordinal integer NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  page_start integer,
  page_end integer
);

CREATE UNIQUE INDEX IF NOT EXISTS ir_document_sections_source_unique ON ir_document_sections(document_id, source_section_id);
CREATE INDEX IF NOT EXISTS ir_document_sections_document_idx ON ir_document_sections(document_id);

CREATE TABLE IF NOT EXISTS ir_evidence_passages (
  id text PRIMARY KEY,
  section_id text NOT NULL REFERENCES ir_document_sections(id) ON DELETE CASCADE,
  source_passage_id text NOT NULL,
  ordinal integer NOT NULL,
  text text NOT NULL,
  word_count integer NOT NULL,
  page_number integer
);

CREATE UNIQUE INDEX IF NOT EXISTS ir_evidence_passages_source_unique ON ir_evidence_passages(section_id, source_passage_id);
CREATE INDEX IF NOT EXISTS ir_evidence_passages_section_idx ON ir_evidence_passages(section_id);
CREATE INDEX IF NOT EXISTS ir_evidence_passages_search_idx ON ir_evidence_passages USING gin(to_tsvector('english', text));
