-- Separate the complete property permit timeline from the dates that describe
-- the currently classified infill project. Leave existing values null until
-- reclassification: copying the old property-wide dates would temporarily
-- present unrelated accessory permits as current infill evidence.
ALTER TABLE "Project"
ADD COLUMN "infillStartDate" DATE,
ADD COLUMN "latestInfillActivityDate" DATE;

CREATE INDEX "Project_infillStartDate_idx" ON "Project"("infillStartDate");
CREATE INDEX "Project_latestInfillActivityDate_idx" ON "Project"("latestInfillActivityDate");
CREATE INDEX "Project_neighbourhoodId_latestInfillActivityDate_idx" ON "Project"("neighbourhoodId", "latestInfillActivityDate");
CREATE INDEX "Project_category_latestInfillActivityDate_idx" ON "Project"("category", "latestInfillActivityDate");
CREATE INDEX "Project_currentStage_latestInfillActivityDate_idx" ON "Project"("currentStage", "latestInfillActivityDate");
CREATE INDEX "Project_infillConfidence_latestInfillActivityDate_idx" ON "Project"("infillConfidence", "latestInfillActivityDate");

-- Reclassification owns the authoritative values. Reuse the pipeline conflict
-- key so this migration cannot create overlapping permit/project work.
INSERT INTO "JobRun" (
  "id",
  "jobType",
  "status",
  "conflictKey",
  "metadata",
  "createdAt",
  "updatedAt"
)
VALUES (
  'migration-00000000000005-infill-activity-dates',
  'PROJECT_RECLASSIFICATION'::"JobType",
  'PENDING'::"RunStatus",
  'job:permit-project-pipeline',
  '{"reason":"recompute-infill-activity-dates","migration":"00000000000005_infill_activity_dates"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;
