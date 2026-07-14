ALTER TABLE filings ADD COLUMN IF NOT EXISTS period_of_report date;

ALTER TABLE reporting_periods ADD COLUMN IF NOT EXISTS period_kind text DEFAULT 'calendar-fallback' NOT NULL;
ALTER TABLE reporting_periods ADD COLUMN IF NOT EXISTS period_basis text DEFAULT 'calendar-fallback' NOT NULL;
ALTER TABLE reporting_periods ADD COLUMN IF NOT EXISTS fiscal_year integer;
ALTER TABLE reporting_periods ADD COLUMN IF NOT EXISTS fiscal_quarter integer;
ALTER TABLE reporting_periods ADD COLUMN IF NOT EXISTS resolution_method text DEFAULT 'publication-date' NOT NULL;
ALTER TABLE reporting_periods ADD COLUMN IF NOT EXISTS resolution_confidence integer DEFAULT 45 NOT NULL;

CREATE TABLE IF NOT EXISTS earnings_packages (
  id text PRIMARY KEY,
  company_id text NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  period_id text NOT NULL REFERENCES reporting_periods(id) ON DELETE CASCADE,
  package_key text NOT NULL,
  label text NOT NULL,
  document_count integer DEFAULT 0 NOT NULL,
  evidence_count integer DEFAULT 0 NOT NULL,
  latest_document_date date NOT NULL,
  resolution_confidence integer NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS earnings_packages_company_key_unique ON earnings_packages(company_id, package_key);
CREATE UNIQUE INDEX IF NOT EXISTS earnings_packages_period_unique ON earnings_packages(period_id);

CREATE TABLE IF NOT EXISTS earnings_package_documents (
  id text PRIMARY KEY,
  package_id text NOT NULL REFERENCES earnings_packages(id) ON DELETE CASCADE,
  source_kind text NOT NULL,
  source_document_id text NOT NULL,
  source_type text NOT NULL,
  document_title text NOT NULL,
  source_url text NOT NULL,
  publication_date date NOT NULL,
  period_of_report date,
  resolution_method text NOT NULL,
  resolution_confidence integer NOT NULL,
  evidence_count integer DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS earnings_package_documents_source_unique ON earnings_package_documents(source_kind, source_document_id);
CREATE INDEX IF NOT EXISTS earnings_package_documents_package_idx ON earnings_package_documents(package_id);
