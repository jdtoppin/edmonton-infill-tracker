CREATE TYPE "ProjectActionType" AS ENUM ('MANUAL_OVERRIDE', 'EVENT_REASSIGNED', 'PROJECT_MERGED', 'MARKED_NOT_RELEVANT');

ALTER TABLE "Project" ADD COLUMN "computedCategory" "ProjectCategory" NOT NULL DEFAULT 'NOT_RELEVANT';
ALTER TABLE "Project" ADD COLUMN "categoryOverride" "ProjectCategory";
ALTER TABLE "Project" ADD COLUMN "computedStage" "ProjectStage" NOT NULL DEFAULT 'DISCOVERED';
ALTER TABLE "Project" ADD COLUMN "stageOverride" "ProjectStage";
ALTER TABLE "Project" ADD COLUMN "marketReviewRequired" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Project"
SET "computedCategory" = "category",
    "computedStage" = "currentStage";

CREATE TABLE "ProjectAction" (
    "id" TEXT NOT NULL,
    "actionType" "ProjectActionType" NOT NULL,
    "projectId" TEXT NOT NULL,
    "relatedProjectId" TEXT,
    "permitEventId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProjectAction_projectId_createdAt_idx" ON "ProjectAction"("projectId", "createdAt");
CREATE INDEX "ProjectAction_relatedProjectId_createdAt_idx" ON "ProjectAction"("relatedProjectId", "createdAt");
CREATE INDEX "ProjectAction_permitEventId_idx" ON "ProjectAction"("permitEventId");
CREATE INDEX "ProjectAction_actorUserId_createdAt_idx" ON "ProjectAction"("actorUserId", "createdAt");
CREATE INDEX "Project_marketReviewRequired_latestEventDate_idx" ON "Project"("marketReviewRequired", "latestEventDate");

ALTER TABLE "ProjectAction" ADD CONSTRAINT "ProjectAction_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectAction" ADD CONSTRAINT "ProjectAction_relatedProjectId_fkey" FOREIGN KEY ("relatedProjectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectAction" ADD CONSTRAINT "ProjectAction_permitEventId_fkey" FOREIGN KEY ("permitEventId") REFERENCES "PermitEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProjectAction" ADD CONSTRAINT "ProjectAction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
