ALTER TABLE "filing_sections" ADD COLUMN "item_code" text;
ALTER TABLE "filing_changes" ADD COLUMN "event_type" text;
ALTER TABLE "filing_changes" ADD COLUMN "event_code" text;
ALTER TABLE "filing_changes" ADD COLUMN "relevance_score" integer;
ALTER TABLE "filing_changes" ADD COLUMN "relevance_reason" text;
