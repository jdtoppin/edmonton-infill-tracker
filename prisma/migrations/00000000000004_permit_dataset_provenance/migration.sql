-- Preserve the normalized source dataset on permit events so reporting and
-- classification never have to infer provenance from human-readable labels.
ALTER TABLE "PermitEvent" ADD COLUMN "sourceDataset" TEXT;

-- Backfill City records already imported by earlier releases. Raw provider
-- payload keys remain stable even when a configurable Socrata view ID changes.
UPDATE "PermitEvent"
SET "sourceDataset" = CASE
  WHEN "rawSourcePayload" ? 'job_category'
    AND "rawSourcePayload" ? 'issue_date' THEN 'building'
  WHEN "rawSourcePayload" ? 'city_file_number'
    AND "rawSourcePayload" ? 'permit_date' THEN 'development'
  WHEN "sourceProvider" LIKE '%:24uj-dj8v' THEN 'building'
  WHEN "sourceProvider" LIKE '%:2ccn-pwtu' THEN 'development'
  ELSE NULL
END
WHERE "sourceDataset" IS NULL;

CREATE INDEX "PermitEvent_sourceDataset_issueDate_idx"
ON "PermitEvent"("sourceDataset", "issueDate");

CREATE INDEX "PermitEvent_sourceDataset_occupancyGrantedDate_idx"
ON "PermitEvent"("sourceDataset", "occupancyGrantedDate");
