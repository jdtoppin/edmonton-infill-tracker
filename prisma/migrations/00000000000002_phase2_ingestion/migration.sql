-- Some public permit rows legitimately omit neighbourhood metadata. Preserve
-- those rows for audit and matching instead of inventing a neighbourhood.
ALTER TABLE "PermitEvent" ALTER COLUMN "neighbourhoodId" DROP NOT NULL;

-- General Building Permits publishes the occupancy milestone as a civil date.
-- A null value means the source does not report occupancy as granted.
ALTER TABLE "PermitEvent" ADD COLUMN "occupancyGrantedDate" DATE;

-- Active-only application keys are cleared at terminal states. Their unique
-- indexes provide database-enforced overlap protection without preventing
-- future completed runs for the same dataset or job family.
ALTER TABLE "ImportRun" ADD COLUMN "activeKey" TEXT;
ALTER TABLE "ImportRun" ADD COLUMN "jobRunId" TEXT;
ALTER TABLE "ImportRun" ADD COLUMN "leaseToken" TEXT;
ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_job_fence_pair_check" CHECK (("jobRunId" IS NULL) = ("leaseToken" IS NULL));
ALTER TABLE "JobRun" ADD COLUMN "conflictKey" TEXT;
ALTER TABLE "JobRun" ADD COLUMN "heartbeatAt" TIMESTAMPTZ(3);
ALTER TABLE "JobRun" ADD COLUMN "lockExpiresAt" TIMESTAMPTZ(3);

CREATE INDEX "PermitEvent_occupancyGrantedDate_idx" ON "PermitEvent"("occupancyGrantedDate");
CREATE UNIQUE INDEX "ImportRun_activeKey_key" ON "ImportRun"("activeKey");
CREATE INDEX "ImportRun_jobRunId_leaseToken_status_idx" ON "ImportRun"("jobRunId", "leaseToken", "status");
CREATE UNIQUE INDEX "JobRun_conflictKey_key" ON "JobRun"("conflictKey");
CREATE INDEX "JobRun_status_lockExpiresAt_idx" ON "JobRun"("status", "lockExpiresAt");

ALTER TABLE "ImportRun" ADD CONSTRAINT "ImportRun_jobRunId_fkey" FOREIGN KEY ("jobRunId") REFERENCES "JobRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
