ALTER TABLE "filing_changes" ALTER COLUMN "previous_filing_id" DROP NOT NULL;
ALTER TABLE "filing_changes" ADD COLUMN "comparison_mode" text DEFAULT 'periodic' NOT NULL;

DROP INDEX "filing_changes_pair_ordinal_unique";
CREATE UNIQUE INDEX "filing_changes_current_ordinal_unique" ON "filing_changes" USING btree ("current_filing_id", "ordinal");
