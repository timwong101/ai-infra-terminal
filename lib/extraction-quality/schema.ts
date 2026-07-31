import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users, workspaces } from "@/lib/db/schema";

export const extractionBenchmarkCases = pgTable("extraction_benchmark_cases", {
  id: text("id").primaryKey(),
  suiteVersion: text("suite_version").notNull(),
  caseVersion: integer("case_version").default(1).notNull(),
  title: text("title").notNull(),
  companyId: text("company_id").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceDocumentId: text("source_document_id").notNull(),
  origin: text("origin").default("curated-real-source").notNull(),
  severity: text("severity").default("high").notNull(),
  expectations: jsonb("expectations").default({}).notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("extraction_benchmark_cases_source_unique").on(table.sourceKind, table.sourceDocumentId),
  index("extraction_benchmark_cases_company_active_idx").on(table.companyId, table.active),
]);

export const extractionQualityRuns = pgTable("extraction_quality_runs", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  ownerUserId: text("owner_user_id").notNull().references(() => users.id, { onDelete: "restrict" }),
  suiteVersion: text("suite_version").notNull(),
  parserVersion: text("parser_version").notNull(),
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
}, (table) => [index("extraction_quality_runs_workspace_started_idx").on(table.workspaceId, table.startedAt)]);

export const extractionQualityResults = pgTable("extraction_quality_results", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull().references(() => extractionQualityRuns.id, { onDelete: "cascade" }),
  benchmarkId: text("benchmark_id").notNull().references(() => extractionBenchmarkCases.id, { onDelete: "restrict" }),
  companyId: text("company_id").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceDocumentId: text("source_document_id").notNull(),
  title: text("title").notNull(),
  status: text("status").notNull(),
  artifactHash: text("artifact_hash"),
  extractionRunId: text("extraction_run_id"),
  scores: jsonb("scores").default({}).notNull(),
  expected: jsonb("expected").default({}).notNull(),
  actual: jsonb("actual").default({}).notNull(),
  failureReasons: jsonb("failure_reasons").default([]).notNull(),
  durationMs: integer("duration_ms").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("extraction_quality_results_run_case_unique").on(table.runId, table.benchmarkId),
  index("extraction_quality_results_run_status_idx").on(table.runId, table.status),
]);

export const parserReleases = pgTable("parser_releases", {
  id: text("id").primaryKey(),
  parserVersion: text("parser_version").notNull(),
  benchmarkRunId: text("benchmark_run_id").notNull().references(() => extractionQualityRuns.id, { onDelete: "restrict" }),
  status: text("status").default("candidate").notNull(),
  qualityScore: integer("quality_score").notNull(),
  releaseNotes: text("release_notes").notNull(),
  promotedByUserId: text("promoted_by_user_id").references(() => users.id, { onDelete: "set null" }),
  promotedAt: timestamp("promoted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  uniqueIndex("parser_releases_run_unique").on(table.benchmarkRunId),
  index("parser_releases_version_status_idx").on(table.parserVersion, table.status),
]);
