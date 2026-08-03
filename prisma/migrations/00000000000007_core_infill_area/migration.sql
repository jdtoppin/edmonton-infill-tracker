CREATE TYPE "InfillAreaClassification" AS ENUM ('CORE', 'OUTSIDE_CORE', 'UNKNOWN');

ALTER TABLE "Project"
ADD COLUMN "infillAreaClassification" "InfillAreaClassification" NOT NULL DEFAULT 'UNKNOWN';

CREATE INDEX "Project_infillAreaClassification_latestInfillActivityDate_idx"
ON "Project"("infillAreaClassification", "latestInfillActivityDate");

-- Reclassification applies the versioned geography rule and scoring adjustment
-- to existing projects. If an earlier pipeline migration is still pending, its
-- job will run the same current code and the shared conflict key avoids overlap.
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
  'migration-00000000000007-core-infill-area',
  'PROJECT_RECLASSIFICATION'::"JobType",
  'PENDING'::"RunStatus",
  'job:permit-project-pipeline',
  '{"reason":"classify-core-infill-area","migration":"00000000000007_core_infill_area","policyVersion":"2026-08-02"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;
