import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const sourceArtifacts = pgTable("source_artifacts", {
  id: text("id").primaryKey(),
  contentHash: text("content_hash").notNull(),
  storageKey: text("storage_key").notNull(),
  storageBackend: text("storage_backend").notNull(),
  storageStatus: text("storage_status").default("available").notNull(),
  contentType: text("content_type").notNull(),
  byteLength: integer("byte_length").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("source_artifacts_content_hash_unique").on(table.contentHash),
  uniqueIndex("source_artifacts_storage_key_unique").on(table.storageKey),
  index("source_artifacts_status_created_idx").on(table.storageStatus, table.createdAt),
]);

export const sourceDocumentVersions = pgTable("source_document_versions", {
  id: text("id").primaryKey(),
  artifactId: text("artifact_id").notNull().references(() => sourceArtifacts.id, { onDelete: "restrict" }),
  sourceKind: text("source_kind").notNull(),
  sourceDocumentId: text("source_document_id").notNull(),
  companyId: text("company_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  etag: text("etag"),
  lastModified: text("last_modified"),
  isCurrent: boolean("is_current").default(true).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("source_document_versions_document_artifact_unique").on(table.sourceKind, table.sourceDocumentId, table.artifactId),
  uniqueIndex("source_document_versions_one_current_unique").on(table.sourceKind, table.sourceDocumentId).where(sql`${table.isCurrent} = true`),
  index("source_document_versions_current_idx").on(table.sourceKind, table.sourceDocumentId, table.isCurrent),
  index("source_document_versions_company_fetched_idx").on(table.companyId, table.fetchedAt),
]);

export const sourceExtractionRuns = pgTable("source_extraction_runs", {
  id: text("id").primaryKey(),
  sourceVersionId: text("source_version_id").notNull().references(() => sourceDocumentVersions.id, { onDelete: "cascade" }),
  artifactId: text("artifact_id").notNull().references(() => sourceArtifacts.id, { onDelete: "restrict" }),
  sourceKind: text("source_kind").notNull(),
  sourceDocumentId: text("source_document_id").notNull(),
  runKind: text("run_kind").notNull(),
  parserName: text("parser_name").notNull(),
  parserVersion: text("parser_version").notNull(),
  codeVersion: text("code_version").notNull(),
  status: text("status").notNull(),
  inputHash: text("input_hash").notNull(),
  outputHash: text("output_hash").notNull(),
  outputSnapshot: jsonb("output_snapshot").default({}).notNull(),
  passageCount: integer("passage_count").default(0).notNull(),
  sectionCount: integer("section_count").default(0).notNull(),
  diffSummary: jsonb("diff_summary").default({}).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  error: text("error"),
  promotedByUserId: text("promoted_by_user_id"),
  promotedAt: timestamp("promoted_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("source_extraction_runs_replay_unique").on(table.sourceVersionId, table.runKind, table.parserVersion, table.outputHash),
  uniqueIndex("source_extraction_runs_one_promoted_unique").on(table.sourceKind, table.sourceDocumentId).where(sql`${table.status} = 'promoted'`),
  index("source_extraction_runs_document_status_idx").on(table.sourceKind, table.sourceDocumentId, table.status, table.startedAt),
  index("source_extraction_runs_artifact_idx").on(table.artifactId),
]);
