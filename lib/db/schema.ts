import { boolean, date, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, vector } from "drizzle-orm/pg-core";

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ticker: text("ticker").notNull(),
  cik: text("cik").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("companies_cik_unique").on(table.cik)]);

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("users_email_unique").on(table.email),
  uniqueIndex("users_provider_account_unique").on(table.provider, table.providerAccountId),
]);

export const workspaces = pgTable("workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdByUserId: text("created_by_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [uniqueIndex("workspaces_slug_unique").on(table.slug)]);

export const workspaceMembers = pgTable("workspace_members", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role").default("analyst").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("workspace_members_workspace_user_unique").on(table.workspaceId, table.userId),
  index("workspace_members_user_idx").on(table.userId),
]);

export const authSessions = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  activeWorkspaceId: text("active_workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("auth_sessions_token_hash_unique").on(table.tokenHash),
  index("auth_sessions_user_idx").on(table.userId),
  index("auth_sessions_expires_idx").on(table.expiresAt),
]);

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  summary: text("summary").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("audit_events_workspace_created_idx").on(table.workspaceId, table.createdAt),
  index("audit_events_actor_idx").on(table.actorUserId, table.createdAt),
]);

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

export const liveEvents = pgTable("live_events", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  theme: text("theme").default("Neoclouds").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceName: text("source_name").notNull(),
  sourceDomain: text("source_domain").notNull(),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  sourceUrl: text("source_url").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  eventType: text("event_type").notNull(),
  materialityScore: integer("materiality_score").notNull(),
  credibilityScore: integer("credibility_score").notNull(),
  evidenceStatus: text("evidence_status").default("discovery").notNull(),
  language: text("language"),
  sourceCountry: text("source_country"),
  fingerprint: text("fingerprint").notNull(),
  raw: jsonb("raw").default({}).notNull(),
  discoveredAt: timestamp("discovered_at", { withTimezone: true }).defaultNow().notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("live_events_fingerprint_unique").on(table.fingerprint),
  index("live_events_company_published_idx").on(table.companyId, table.publishedAt),
  index("live_events_status_materiality_idx").on(table.evidenceStatus, table.materialityScore),
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
  isStale: boolean("is_stale").default(false).notNull(),
  staleReason: text("stale_reason"),
  staleAt: timestamp("stale_at", { withTimezone: true }),
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

export const eventClaimImpacts = pgTable("event_claim_impacts", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => liveEvents.id, { onDelete: "cascade" }),
  claimId: text("claim_id").notNull().references(() => researchClaims.id, { onDelete: "cascade" }),
  impact: text("impact").notNull(),
  impactScore: integer("impact_score").notNull(),
  rationale: text("rationale").notNull(),
  status: text("status").default("proposed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("event_claim_impacts_event_claim_unique").on(table.eventId, table.claimId),
  index("event_claim_impacts_claim_status_idx").on(table.claimId, table.status),
]);

export const researchAlerts = pgTable("research_alerts", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  filingId: text("filing_id").references(() => filings.id, { onDelete: "cascade" }),
  filingChangeId: text("filing_change_id").references(() => filingChanges.id, { onDelete: "cascade" }),
  claimId: text("claim_id").references(() => researchClaims.id, { onDelete: "cascade" }),
  researchEvidenceId: text("research_evidence_id"),
  liveEventId: text("live_event_id").references(() => liveEvents.id, { onDelete: "cascade" }),
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
  uniqueIndex("research_alerts_live_event_unique").on(table.liveEventId),
  index("research_alerts_status_significance_idx").on(table.status, table.significance),
  index("research_alerts_company_idx").on(table.companyId),
]);

export const userAlertStates = pgTable("user_alert_states", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  alertId: text("alert_id").notNull().references(() => researchAlerts.id, { onDelete: "cascade" }),
  status: text("status").default("unread").notNull(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("user_alert_states_scope_unique").on(table.workspaceId, table.userId, table.alertId),
  index("user_alert_states_user_status_idx").on(table.workspaceId, table.userId, table.status),
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
  evidenceQualityScore: integer("evidence_quality_score").default(0).notNull(),
  materialityScore: integer("materiality_score").default(0).notNull(),
  specificityScore: integer("specificity_score").default(0).notNull(),
  relevanceScore: integer("relevance_score").default(0).notNull(),
  boilerplateRisk: integer("boilerplate_risk").default(0).notNull(),
  qualityReasons: jsonb("quality_reasons").default([]).notNull(),
  duplicateGroupId: text("duplicate_group_id"),
  duplicateCount: integer("duplicate_count").default(1).notNull(),
  suggestedClaimId: text("suggested_claim_id"),
  suggestedImpact: text("suggested_impact"),
  suggestionConfidence: integer("suggestion_confidence").default(0).notNull(),
  suggestionRationale: text("suggestion_rationale"),
  suggestionStatus: text("suggestion_status").default("pending").notNull(),
  qualityScoredAt: timestamp("quality_scored_at", { withTimezone: true }),
  contentHash: text("content_hash").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  embeddedAt: timestamp("embedded_at", { withTimezone: true }),
  reviewStatus: text("review_status").default("unreviewed").notNull(),
  reviewNote: text("review_note"),
  reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("research_evidence_source_passage_unique").on(table.sourceKind, table.sourcePassageId),
  index("research_evidence_company_date_idx").on(table.companyId, table.documentDate),
  index("research_evidence_review_topic_idx").on(table.reviewStatus, table.topic),
  index("research_evidence_quality_review_idx").on(table.reviewStatus, table.evidenceQualityScore),
  index("research_evidence_suggestion_idx").on(table.suggestionStatus, table.suggestedClaimId),
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

export const earningsChangeBriefs = pgTable("earnings_change_briefs", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  currentPeriodId: text("current_period_id").notNull().references(() => reportingPeriods.id, { onDelete: "cascade" }),
  previousPeriodId: text("previous_period_id").references(() => reportingPeriods.id, { onDelete: "cascade" }),
  headline: text("headline").notNull(),
  summary: text("summary").notNull(),
  thesisImpact: text("thesis_impact").notNull(),
  confidenceScore: integer("confidence_score").notNull(),
  evidenceQualityScore: integer("evidence_quality_score").notNull(),
  sourceDiversityScore: integer("source_diversity_score").notNull(),
  changeCount: integer("change_count").notNull(),
  engine: text("engine").default("deterministic-v1").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("earnings_change_briefs_period_pair_unique").on(table.currentPeriodId, table.previousPeriodId),
  index("earnings_change_briefs_company_period_idx").on(table.companyId, table.currentPeriodId),
]);

export const earningsChangeBriefClaims = pgTable("earnings_change_brief_claims", {
  id: text("id").primaryKey(),
  briefId: text("brief_id").notNull().references(() => earningsChangeBriefs.id, { onDelete: "cascade" }),
  ordinal: integer("ordinal").notNull(),
  section: text("section").notNull(),
  title: text("title").notNull(),
  text: text("text").notNull(),
  sentiment: text("sentiment").notNull(),
  significance: text("significance").notNull(),
  comparisonId: text("comparison_id").references(() => periodComparisons.id, { onDelete: "set null" }),
  evidenceIds: jsonb("evidence_ids").default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("earnings_change_brief_claims_ordinal_unique").on(table.briefId, table.ordinal),
  index("earnings_change_brief_claims_brief_section_idx").on(table.briefId, table.section),
]);

export const earningsChangeBriefVersions = pgTable("earnings_change_brief_versions", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  currentPeriodKey: text("current_period_key").notNull(),
  currentPeriodLabel: text("current_period_label").notNull(),
  previousPeriodKey: text("previous_period_key").notNull(),
  previousPeriodLabel: text("previous_period_label").notNull(),
  thesisImpact: text("thesis_impact").notNull(),
  confidenceScore: integer("confidence_score").notNull(),
  contentHash: text("content_hash").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("earnings_change_brief_versions_content_unique").on(table.companyId, table.currentPeriodKey, table.previousPeriodKey, table.contentHash),
  index("earnings_change_brief_versions_period_idx").on(table.companyId, table.currentPeriodKey, table.generatedAt),
]);

export const comparisonMemos = pgTable("comparison_memos", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  question: text("question").notNull(),
  companyAId: text("company_a_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  companyBId: text("company_b_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  topic: text("topic").notNull(),
  confidenceScore: integer("confidence_score").notNull(),
  evidenceQualityScore: integer("evidence_quality_score").notNull(),
  sourceDiversityScore: integer("source_diversity_score").notNull(),
  status: text("status").default("draft").notNull(),
  isStale: boolean("is_stale").default(false).notNull(),
  staleReason: text("stale_reason"),
  staleAt: timestamp("stale_at", { withTimezone: true }),
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
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
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

export const researchAssistantSessions = pgTable("research_assistant_sessions", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  companyIds: jsonb("company_ids").default([]).notNull(),
  topic: text("topic").default("All topics").notNull(),
  sourceKinds: jsonb("source_kinds").default([]).notNull(),
  dateFrom: date("date_from"),
  dateTo: date("date_to"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("research_assistant_sessions_updated_idx").on(table.updatedAt)]);

export const researchAssistantMessages = pgTable("research_assistant_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().references(() => researchAssistantSessions.id, { onDelete: "cascade" }),
  question: text("question").notNull(),
  answerMarkdown: text("answer_markdown"),
  claims: jsonb("claims").default([]).notNull(),
  openQuestions: jsonb("open_questions").default([]).notNull(),
  confidenceScore: integer("confidence_score"),
  evidenceQualityScore: integer("evidence_quality_score"),
  sourceDiversityScore: integer("source_diversity_score"),
  engine: text("engine").notNull(),
  model: text("model").notNull(),
  retrievalMode: text("retrieval_mode").default("pending").notNull(),
  status: text("status").default("running").notNull(),
  filters: jsonb("filters").notNull(),
  evidenceSnapshot: jsonb("evidence_snapshot").default([]).notNull(),
  verification: jsonb("verification"),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("research_assistant_messages_session_idx").on(table.sessionId, table.createdAt),
  index("research_assistant_messages_status_idx").on(table.status, table.createdAt),
]);

export const researchQualityRuns = pgTable("research_quality_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  suiteVersion: text("suite_version").notNull(),
  engine: text("engine").notNull(),
  status: text("status").default("running").notNull(),
  overallScore: integer("overall_score"),
  passRate: integer("pass_rate"),
  metrics: jsonb("metrics").default({}).notNull(),
  caseCount: integer("case_count").default(0).notNull(),
  passedCount: integer("passed_count").default(0).notNull(),
  failedCount: integer("failed_count").default(0).notNull(),
  durationMs: integer("duration_ms"),
  error: text("error"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("research_quality_runs_created_idx").on(table.createdAt)]);

export const researchQualityResults = pgTable("research_quality_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => researchQualityRuns.id, { onDelete: "cascade" }),
  benchmarkId: text("benchmark_id").notNull(),
  title: text("title").notNull(),
  category: text("category").notNull(),
  question: text("question").notNull(),
  companyIds: jsonb("company_ids").default([]).notNull(),
  expectations: jsonb("expectations").default({}).notNull(),
  status: text("status").notNull(),
  scores: jsonb("scores").default({}).notNull(),
  failureReasons: jsonb("failure_reasons").default([]).notNull(),
  evidenceSnapshot: jsonb("evidence_snapshot").default([]).notNull(),
  claims: jsonb("claims").default([]).notNull(),
  retrievalMode: text("retrieval_mode").notNull(),
  citationCount: integer("citation_count").default(0).notNull(),
  unsupportedClaimCount: integer("unsupported_claim_count").default(0).notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCostMicros: integer("estimated_cost_micros").default(0).notNull(),
  latencyMs: integer("latency_ms").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("research_quality_results_run_benchmark_unique").on(table.runId, table.benchmarkId),
  index("research_quality_results_run_status_idx").on(table.runId, table.status),
]);

export const researchReplayRuns = pgTable("research_replay_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  asOfDate: date("as_of_date").notNull(),
  mode: text("mode").default("system-known").notNull(),
  companyIds: jsonb("company_ids").default([]).notNull(),
  topic: text("topic").default("All topics").notNull(),
  question: text("question").notNull(),
  status: text("status").default("completed").notNull(),
  summary: text("summary").notNull(),
  historicalClaims: jsonb("historical_claims").default([]).notNull(),
  currentClaims: jsonb("current_claims").default([]).notNull(),
  historicalEvidenceSnapshot: jsonb("historical_evidence_snapshot").default([]).notNull(),
  currentEvidenceSnapshot: jsonb("current_evidence_snapshot").default([]).notNull(),
  addedEvidenceSnapshot: jsonb("added_evidence_snapshot").default([]).notNull(),
  metrics: jsonb("metrics").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("research_replay_runs_workspace_created_idx").on(table.workspaceId, table.createdAt),
  index("research_replay_runs_as_of_idx").on(table.asOfDate),
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

export const researchCycleEvents = pgTable("research_cycle_events", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => researchCycleRuns.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  status: text("status").default("running").notNull(),
  attempt: integer("attempt").default(1).notNull(),
  message: text("message"),
  metrics: jsonb("metrics").default({}).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [index("research_cycle_events_run_stage_idx").on(table.runId, table.stage, table.startedAt)]);

export const researchBriefings = pgTable("research_briefings", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => researchCycleRuns.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  status: text("status").default("ready").notNull(),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
  windowEndedAt: timestamp("window_ended_at", { withTimezone: true }).notNull(),
  stats: jsonb("stats").default({}).notNull(),
  sections: jsonb("sections").default([]).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  index("research_briefings_created_idx").on(table.createdAt),
  index("research_briefings_run_idx").on(table.runId),
]);
