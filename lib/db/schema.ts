import { date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, vector } from "drizzle-orm/pg-core";

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ticker: text("ticker").notNull(),
  cik: text("cik").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("companies_cik_unique").on(table.cik)]);

export const filings = pgTable("filings", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  accessionNumber: text("accession_number").notNull(),
  formType: text("form_type").notNull(),
  filedAt: date("filed_at").notNull(),
  periodOfReport: date("period_of_report"),
  sourceUrl: text("source_url").notNull(),
  documentTitle: text("document_title").notNull(),
  wordCount: integer("word_count").notNull(),
  extractionQuality: text("extraction_quality").notNull(),
  extractionMessage: text("extraction_message").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("filings_accession_unique").on(table.accessionNumber),
  index("filings_company_form_date_idx").on(table.companyId, table.formType, table.filedAt),
]);

export const filingSections = pgTable("filing_sections", {
  id: text("id").primaryKey(),
  filingId: text("filing_id").notNull().references(() => filings.id, { onDelete: "cascade" }),
  sourceSectionId: text("source_section_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  itemCode: text("item_code"),
}, (table) => [
  uniqueIndex("filing_sections_source_unique").on(table.filingId, table.sourceSectionId),
  index("filing_sections_filing_idx").on(table.filingId),
]);

export const evidencePassages = pgTable("evidence_passages", {
  id: text("id").primaryKey(),
  sectionId: text("section_id").notNull().references(() => filingSections.id, { onDelete: "cascade" }),
  sourcePassageId: text("source_passage_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  wordCount: integer("word_count").notNull(),
}, (table) => [
  uniqueIndex("evidence_passages_source_unique").on(table.sectionId, table.sourcePassageId),
  index("evidence_passages_section_idx").on(table.sectionId),
]);

export const irDocuments = pgTable("ir_documents", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  publishedAt: date("published_at").notNull(),
  title: text("title").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourcePageUrl: text("source_page_url").notNull(),
  wordCount: integer("word_count").notNull(),
  pageCount: integer("page_count"),
  extractionMethod: text("extraction_method").notNull(),
  extractionQuality: text("extraction_quality").notNull(),
  extractionMessage: text("extraction_message").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("ir_documents_source_url_unique").on(table.sourceUrl),
  index("ir_documents_company_type_date_idx").on(table.companyId, table.documentType, table.publishedAt),
]);

export const irSourceDocuments = pgTable("ir_source_documents", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  documentType: text("document_type").notNull(),
  publishedAt: date("published_at").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourcePageUrl: text("source_page_url").notNull(),
  sourceQuality: integer("source_quality").notNull(),
  relevanceScore: integer("relevance_score").notNull(),
  signal: text("signal").notNull(),
  extractionStatus: text("extraction_status").default("pending").notNull(),
  attempts: integer("attempts").default(0).notNull(),
  lastError: text("last_error"),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  lastAttemptedAt: timestamp("last_attempted_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("ir_source_documents_source_url_unique").on(table.sourceUrl),
  index("ir_source_documents_status_date_idx").on(table.extractionStatus, table.publishedAt),
  index("ir_source_documents_company_date_idx").on(table.companyId, table.publishedAt),
]);

export const irDocumentSections = pgTable("ir_document_sections", {
  id: text("id").primaryKey(),
  documentId: text("document_id").notNull().references(() => irDocuments.id, { onDelete: "cascade" }),
  sourceSectionId: text("source_section_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  pageStart: integer("page_start"),
  pageEnd: integer("page_end"),
}, (table) => [
  uniqueIndex("ir_document_sections_source_unique").on(table.documentId, table.sourceSectionId),
  index("ir_document_sections_document_idx").on(table.documentId),
]);

export const irEvidencePassages = pgTable("ir_evidence_passages", {
  id: text("id").primaryKey(),
  sectionId: text("section_id").notNull().references(() => irDocumentSections.id, { onDelete: "cascade" }),
  sourcePassageId: text("source_passage_id").notNull(),
  ordinal: integer("ordinal").notNull(),
  text: text("text").notNull(),
  wordCount: integer("word_count").notNull(),
  pageNumber: integer("page_number"),
}, (table) => [
  uniqueIndex("ir_evidence_passages_source_unique").on(table.sectionId, table.sourcePassageId),
  index("ir_evidence_passages_section_idx").on(table.sectionId),
]);

export const filingChanges = pgTable("filing_changes", {
  id: text("id").primaryKey(),
  currentFilingId: text("current_filing_id").notNull().references(() => filings.id, { onDelete: "cascade" }),
  previousFilingId: text("previous_filing_id").references(() => filings.id, { onDelete: "cascade" }),
  comparisonMode: text("comparison_mode").default("periodic").notNull(),
  ordinal: integer("ordinal").notNull(),
  changeType: text("change_type").notNull(),
  significance: text("significance").notNull(),
  category: text("category").notNull(),
  sectionTitle: text("section_title").notNull(),
  summary: text("summary").notNull(),
  similarity: integer("similarity"),
  currentText: text("current_text"),
  previousText: text("previous_text"),
  eventType: text("event_type"),
  eventCode: text("event_code"),
  relevanceScore: integer("relevance_score"),
  relevanceReason: text("relevance_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("filing_changes_current_ordinal_unique").on(table.currentFilingId, table.ordinal),
  index("filing_changes_current_idx").on(table.currentFilingId),
]);

export const researchClaims = pgTable("research_claims", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  theme: text("theme").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  statement: text("statement").notNull(),
  supportScore: integer("support_score").default(50).notNull(),
  status: text("status").default("active").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("research_claims_company_kind_unique").on(table.companyId, table.kind),
  index("research_claims_theme_idx").on(table.theme),
]);

export const claimEvidence = pgTable("claim_evidence", {
  id: text("id").primaryKey(),
  claimId: text("claim_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
  filingChangeId: text("filing_change_id").references(() => filingChanges.id, { onDelete: "cascade" }),
  researchEvidenceId: text("research_evidence_id"),
  impact: text("impact").notNull(),
  impactScore: integer("impact_score").notNull(),
  rationale: text("rationale").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("claim_evidence_claim_change_unique").on(table.claimId, table.filingChangeId),
  uniqueIndex("claim_evidence_claim_research_unique").on(table.claimId, table.researchEvidenceId),
  index("claim_evidence_claim_idx").on(table.claimId),
]);

export const researchAlerts = pgTable("research_alerts", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  filingId: text("filing_id").references(() => filings.id, { onDelete: "cascade" }),
  filingChangeId: text("filing_change_id").references(() => filingChanges.id, { onDelete: "cascade" }),
  claimId: text("claim_id").references(() => researchClaims.id, { onDelete: "cascade" }),
  researchEvidenceId: text("research_evidence_id"),
  alertType: text("alert_type").default("filing_change").notNull(),
  category: text("category").notNull(),
  significance: text("significance").notNull(),
  impact: text("impact").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").default("unread").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("research_alerts_change_unique").on(table.filingChangeId),
  uniqueIndex("research_alerts_claim_evidence_unique").on(table.claimId, table.researchEvidenceId),
  index("research_alerts_status_significance_idx").on(table.status, table.significance),
  index("research_alerts_company_idx").on(table.companyId),
]);

export const thesisSnapshots = pgTable("thesis_snapshots", {
  id: text("id").primaryKey(),
  claimId: text("claim_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
  snapshotDate: date("snapshot_date").notNull(),
  supportScore: integer("support_score").notNull(),
  evidenceCount: integer("evidence_count").notNull(),
  supportingCount: integer("supporting_count").notNull(),
  weakeningCount: integer("weakening_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("thesis_snapshots_claim_date_unique").on(table.claimId, table.snapshotDate),
  index("thesis_snapshots_claim_idx").on(table.claimId),
]);

export const researchEvidence = pgTable("research_evidence", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull(),
  sourceDocumentId: text("source_document_id").notNull(),
  sourcePassageId: text("source_passage_id").notNull(),
  sourceType: text("source_type").notNull(),
  documentTitle: text("document_title").notNull(),
  documentDate: date("document_date").notNull(),
  sectionTitle: text("section_title").notNull(),
  topic: text("topic").notNull(),
  excerpt: text("excerpt").notNull(),
  sourceUrl: text("source_url").notNull(),
  pageNumber: integer("page_number"),
  sourceQuality: integer("source_quality").notNull(),
  contentHash: text("content_hash").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddedAt: timestamp("embedded_at", { withTimezone: true }),
  reviewStatus: text("review_status").default("unreviewed").notNull(),
  reviewNote: text("review_note"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("research_evidence_source_passage_unique").on(table.sourceKind, table.sourcePassageId),
  index("research_evidence_company_date_idx").on(table.companyId, table.documentDate),
  index("research_evidence_review_topic_idx").on(table.reviewStatus, table.topic),
]);

export const reportingPeriods = pgTable("reporting_periods", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  periodKey: text("period_key").notNull(),
  label: text("label").notNull(),
  calendarYear: integer("calendar_year").notNull(),
  calendarQuarter: integer("calendar_quarter").notNull(),
  periodKind: text("period_kind").default("calendar-fallback").notNull(),
  periodBasis: text("period_basis").default("calendar-fallback").notNull(),
  fiscalYear: integer("fiscal_year"),
  fiscalQuarter: integer("fiscal_quarter"),
  resolutionMethod: text("resolution_method").default("publication-date").notNull(),
  resolutionConfidence: integer("resolution_confidence").default(45).notNull(),
  periodStart: date("period_start").notNull(),
  periodEnd: date("period_end").notNull(),
  latestDocumentDate: date("latest_document_date").notNull(),
  evidenceCount: integer("evidence_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("reporting_periods_company_key_unique").on(table.companyId, table.periodKey),
  index("reporting_periods_company_date_idx").on(table.companyId, table.periodEnd),
]);

export const earningsPackages = pgTable("earnings_packages", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  periodId: text("period_id").notNull().references(() => reportingPeriods.id, { onDelete: "cascade" }),
  packageKey: text("package_key").notNull(),
  label: text("label").notNull(),
  documentCount: integer("document_count").default(0).notNull(),
  evidenceCount: integer("evidence_count").default(0).notNull(),
  latestDocumentDate: date("latest_document_date").notNull(),
  resolutionConfidence: integer("resolution_confidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("earnings_packages_company_key_unique").on(table.companyId, table.packageKey),
  uniqueIndex("earnings_packages_period_unique").on(table.periodId),
]);

export const earningsPackageDocuments = pgTable("earnings_package_documents", {
  id: text("id").primaryKey(),
  packageId: text("package_id").notNull().references(() => earningsPackages.id, { onDelete: "cascade" }),
  sourceKind: text("source_kind").notNull(),
  sourceDocumentId: text("source_document_id").notNull(),
  sourceType: text("source_type").notNull(),
  documentTitle: text("document_title").notNull(),
  sourceUrl: text("source_url").notNull(),
  publicationDate: date("publication_date").notNull(),
  periodOfReport: date("period_of_report"),
  resolutionMethod: text("resolution_method").notNull(),
  resolutionConfidence: integer("resolution_confidence").notNull(),
  extractionStatus: text("extraction_status"),
  evidenceCount: integer("evidence_count").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("earnings_package_documents_source_unique").on(table.sourceKind, table.sourceDocumentId),
  index("earnings_package_documents_package_idx").on(table.packageId),
]);

export const companyMetrics = pgTable("company_metrics", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  periodId: text("period_id").notNull().references(() => reportingPeriods.id, { onDelete: "cascade" }),
  sourceEvidenceId: text("source_evidence_id").notNull().references(() => researchEvidence.id, { onDelete: "cascade" }),
  metricKey: text("metric_key").notNull(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  normalizedValue: text("normalized_value").notNull(),
  displayValue: text("display_value").notNull(),
  unit: text("unit").notNull(),
  context: text("context").notNull(),
  confidence: integer("confidence").notNull(),
  documentDate: date("document_date").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("company_metrics_evidence_key_unique").on(table.sourceEvidenceId, table.metricKey),
  index("company_metrics_period_key_idx").on(table.periodId, table.metricKey),
]);

export const periodComparisons = pgTable("period_comparisons", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  currentPeriodId: text("current_period_id").notNull().references(() => reportingPeriods.id, { onDelete: "cascade" }),
  previousPeriodId: text("previous_period_id").references(() => reportingPeriods.id, { onDelete: "cascade" }),
  currentMetricId: text("current_metric_id").references(() => companyMetrics.id, { onDelete: "cascade" }),
  previousMetricId: text("previous_metric_id").references(() => companyMetrics.id, { onDelete: "set null" }),
  comparisonKey: text("comparison_key").notNull(),
  comparisonKind: text("comparison_kind").notNull(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  direction: text("direction").notNull(),
  significance: text("significance").notNull(),
  currentValue: text("current_value"),
  previousValue: text("previous_value"),
  deltaPercent: integer("delta_percent"),
  summary: text("summary").notNull(),
  currentText: text("current_text"),
  previousText: text("previous_text"),
  evidenceIds: jsonb("evidence_ids").default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("period_comparisons_period_key_unique").on(table.currentPeriodId, table.comparisonKey),
  index("period_comparisons_company_period_idx").on(table.companyId, table.currentPeriodId),
]);

export const comparisonMemos = pgTable("comparison_memos", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  question: text("question").notNull(),
  companyAId: text("company_a_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  companyBId: text("company_b_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  confidenceScore: integer("confidence_score").notNull(),
  evidenceQualityScore: integer("evidence_quality_score").notNull(),
  sourceDiversityScore: integer("source_diversity_score").notNull(),
  status: text("status").default("draft").notNull(),
  sections: jsonb("sections").notNull(),
  evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("comparison_memos_company_pair_idx").on(table.companyAId, table.companyBId),
  index("comparison_memos_updated_idx").on(table.updatedAt),
]);

export const memoGenerations = pgTable("memo_generations", {
  id: text("id").primaryKey(),
  memoId: text("memo_id").references(() => comparisonMemos.id, { onDelete: "set null" }),
  companyAId: text("company_a_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  companyBId: text("company_b_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  question: text("question").notNull(),
  prompt: text("prompt").notNull(),
  model: text("model").notNull(),
  engine: text("engine").notNull(),
  retrievalMode: text("retrieval_mode").notNull(),
  status: text("status").default("running").notNull(),
  output: jsonb("output"),
  evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
  verification: jsonb("verification"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("memo_generations_status_idx").on(table.status, table.createdAt),
  index("memo_generations_pair_idx").on(table.companyAId, table.companyBId),
]);

export const researchCycleRuns = pgTable("research_cycle_runs", {
  id: text("id").primaryKey(),
  trigger: text("trigger").notNull(),
  status: text("status").default("running").notNull(),
  stage: text("stage").default("starting").notNull(),
  metrics: jsonb("metrics").default({}).notNull(),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("research_cycle_runs_status_idx").on(table.status, table.startedAt)]);
