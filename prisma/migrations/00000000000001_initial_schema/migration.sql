-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ProjectCategory" AS ENUM ('PROBABLE_NEW_DETACHED_INFILL', 'PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE', 'PROBABLE_SEMI_DETACHED_INFILL', 'PROBABLE_DUPLEX', 'PROBABLE_ROW_HOUSING', 'PROBABLE_GARDEN_SUITE', 'DEMOLITION_ONLY', 'RENOVATION_OR_ADDITION', 'UNCERTAIN_RESIDENTIAL_DEVELOPMENT', 'NOT_RELEVANT');

-- CreateEnum
CREATE TYPE "ProjectStage" AS ENUM ('DISCOVERED', 'DEMOLITION', 'DEVELOPMENT_APPLICATION', 'DEVELOPMENT_PERMIT', 'BUILDING_PERMIT', 'CONSTRUCTION', 'INSPECTION', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CORRECTED', 'NOT_RELEVANT', 'MERGED');

-- CreateEnum
CREATE TYPE "MarketListingStatus" AS ENUM ('NOT_CHECKED', 'NO_MATCH', 'POSSIBLE_MATCH', 'CONFIRMED_MATCH');

-- CreateEnum
CREATE TYPE "AlertFrequency" AS ENUM ('IMMEDIATE', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('NEW_PROJECT', 'NEW_PERMIT_EVENT', 'PROJECT_UPDATED', 'PROJECT_STAGE_CHANGED');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ImportMode" AS ENUM ('INCREMENTAL', 'BACKFILL', 'MANUAL');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "RawRecordStatus" AS ENUM ('PENDING', 'PROCESSED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('INCREMENTAL_PERMIT_IMPORT', 'PROJECT_MATCHING', 'PROJECT_RECLASSIFICATION', 'ALERT_GENERATION', 'DAILY_ALERT_DELIVERY', 'DATA_QUALITY_CHECK');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalizedEmail" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Neighbourhood" (
    "id" TEXT NOT NULL,
    "cityNeighbourhoodId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "boundary" geometry(MultiPolygon, 4326),
    "isMonitoringActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Neighbourhood_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Address" (
    "id" TEXT NOT NULL,
    "rawSourceAddress" TEXT NOT NULL,
    "normalizedStreetAddress" TEXT NOT NULL,
    "normalizedAddressKey" TEXT NOT NULL,
    "unitNumber" TEXT,
    "city" TEXT NOT NULL DEFAULT 'Edmonton',
    "province" TEXT NOT NULL DEFAULT 'AB',
    "postalCode" TEXT,
    "latitude" DECIMAL(9,6),
    "longitude" DECIMAL(9,6),
    "location" geometry(Point, 4326),
    "geocodingConfidence" DECIMAL(4,3),
    "neighbourhoodId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Address_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRun" (
    "id" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "mode" "ImportMode" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "requestedFrom" TIMESTAMPTZ(3),
    "requestedTo" TIMESTAMPTZ(3),
    "startCursor" TEXT,
    "endCursor" TEXT,
    "recordsFetched" INTEGER NOT NULL DEFAULT 0,
    "recordsCreated" INTEGER NOT NULL DEFAULT 0,
    "recordsUpdated" INTEGER NOT NULL DEFAULT 0,
    "recordsSkipped" INTEGER NOT NULL DEFAULT 0,
    "recordsFailed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "errorSummary" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImportRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawPermitRecord" (
    "id" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "sourceRecordIdentifier" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payloadChecksum" TEXT NOT NULL,
    "sourceUpdatedAt" TIMESTAMPTZ(3),
    "processingStatus" "RawRecordStatus" NOT NULL DEFAULT 'PENDING',
    "processingError" TEXT,
    "firstImportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastImportedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importRunId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RawPermitRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportFailure" (
    "id" TEXT NOT NULL,
    "importRunId" TEXT NOT NULL,
    "sourceRecordIdentifier" TEXT NOT NULL,
    "errorCode" TEXT,
    "errorMessage" TEXT NOT NULL,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportFailure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PermitEvent" (
    "id" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "sourceRecordIdentifier" TEXT NOT NULL,
    "permitNumber" TEXT,
    "permitType" TEXT NOT NULL,
    "permitSubtype" TEXT,
    "applicationDate" DATE,
    "issueDate" DATE,
    "status" TEXT,
    "workDescription" TEXT,
    "buildingType" TEXT,
    "constructionValue" DECIMAL(15,2),
    "unitsAdded" INTEGER,
    "addressId" TEXT NOT NULL,
    "neighbourhoodId" TEXT NOT NULL,
    "rawRecordId" TEXT,
    "rawSourcePayload" JSONB NOT NULL,
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PermitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "projectKey" TEXT NOT NULL,
    "addressId" TEXT NOT NULL,
    "neighbourhoodId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "ProjectCategory" NOT NULL,
    "currentStage" "ProjectStage" NOT NULL,
    "earliestEventDate" DATE,
    "latestEventDate" DATE,
    "estimatedUnits" INTEGER,
    "estimatedConstructionValue" DECIMAL(15,2),
    "marketListingStatus" "MarketListingStatus" NOT NULL DEFAULT 'NOT_CHECKED',
    "marketComparison" JSONB,
    "marketLastCheckedAt" TIMESTAMPTZ(3),
    "infillConfidence" INTEGER NOT NULL DEFAULT 0,
    "confidenceExplanation" JSONB NOT NULL,
    "reviewStatus" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "reviewNotes" TEXT,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectEvent" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "permitEventId" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "linkedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "matchReason" JSONB,

    CONSTRAINT "ProjectEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "projectCategories" "ProjectCategory"[] DEFAULT ARRAY[]::"ProjectCategory"[],
    "minConstructionValue" DECIMAL(15,2),
    "maxConstructionValue" DECIMAL(15,2),
    "minUnits" INTEGER,
    "maxUnits" INTEGER,
    "minConfidenceScore" INTEGER,
    "permitStatuses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "projectStages" "ProjectStage"[] DEFAULT ARRAY[]::"ProjectStage"[],
    "alertFrequency" "AlertFrequency" NOT NULL DEFAULT 'DAILY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SavedSearch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedSearchNeighbourhood" (
    "savedSearchId" TEXT NOT NULL,
    "neighbourhoodId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedSearchNeighbourhood_pkey" PRIMARY KEY ("savedSearchId","neighbourhoodId")
);

-- CreateTable
CREATE TABLE "AlertEvent" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "savedSearchId" TEXT,
    "projectId" TEXT NOT NULL,
    "triggeringPermitEventId" TEXT NOT NULL,
    "alertType" "AlertType" NOT NULL,
    "deliveryStatus" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "deliveredAt" TIMESTAMPTZ(3),
    "errorMessage" TEXT,
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AlertEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "jobType" "JobType" NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'PENDING',
    "lockKey" TEXT,
    "processedCount" INTEGER NOT NULL DEFAULT 0,
    "successfulCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "errorSummary" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Neighbourhood_cityNeighbourhoodId_key" ON "Neighbourhood"("cityNeighbourhoodId");

-- CreateIndex
CREATE INDEX "Neighbourhood_name_idx" ON "Neighbourhood"("name");

-- CreateIndex
CREATE INDEX "Neighbourhood_isMonitoringActive_idx" ON "Neighbourhood"("isMonitoringActive");

-- CreateIndex
CREATE UNIQUE INDEX "Address_normalizedAddressKey_key" ON "Address"("normalizedAddressKey");

-- CreateIndex
CREATE INDEX "Address_neighbourhoodId_idx" ON "Address"("neighbourhoodId");

-- CreateIndex
CREATE INDEX "Address_normalizedStreetAddress_idx" ON "Address"("normalizedStreetAddress");

-- CreateIndex
CREATE INDEX "Address_latitude_longitude_idx" ON "Address"("latitude", "longitude");

-- CreateIndex
CREATE INDEX "ImportRun_sourceProvider_createdAt_idx" ON "ImportRun"("sourceProvider", "createdAt");

-- CreateIndex
CREATE INDEX "ImportRun_status_createdAt_idx" ON "ImportRun"("status", "createdAt");

-- CreateIndex
CREATE INDEX "RawPermitRecord_importRunId_idx" ON "RawPermitRecord"("importRunId");

-- CreateIndex
CREATE INDEX "RawPermitRecord_processingStatus_lastImportedAt_idx" ON "RawPermitRecord"("processingStatus", "lastImportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawPermitRecord_sourceProvider_sourceRecordIdentifier_key" ON "RawPermitRecord"("sourceProvider", "sourceRecordIdentifier");

-- CreateIndex
CREATE INDEX "ImportFailure_createdAt_idx" ON "ImportFailure"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportFailure_importRunId_sourceRecordIdentifier_key" ON "ImportFailure"("importRunId", "sourceRecordIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "PermitEvent_rawRecordId_key" ON "PermitEvent"("rawRecordId");

-- CreateIndex
CREATE INDEX "PermitEvent_permitNumber_idx" ON "PermitEvent"("permitNumber");

-- CreateIndex
CREATE INDEX "PermitEvent_addressId_idx" ON "PermitEvent"("addressId");

-- CreateIndex
CREATE INDEX "PermitEvent_neighbourhoodId_issueDate_idx" ON "PermitEvent"("neighbourhoodId", "issueDate");

-- CreateIndex
CREATE INDEX "PermitEvent_applicationDate_idx" ON "PermitEvent"("applicationDate");

-- CreateIndex
CREATE INDEX "PermitEvent_sourceUpdatedAt_idx" ON "PermitEvent"("sourceUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PermitEvent_sourceProvider_sourceRecordIdentifier_key" ON "PermitEvent"("sourceProvider", "sourceRecordIdentifier");

-- CreateIndex
CREATE UNIQUE INDEX "Project_projectKey_key" ON "Project"("projectKey");

-- CreateIndex
CREATE INDEX "Project_addressId_latestEventDate_idx" ON "Project"("addressId", "latestEventDate");

-- CreateIndex
CREATE INDEX "Project_neighbourhoodId_latestEventDate_idx" ON "Project"("neighbourhoodId", "latestEventDate");

-- CreateIndex
CREATE INDEX "Project_category_latestEventDate_idx" ON "Project"("category", "latestEventDate");

-- CreateIndex
CREATE INDEX "Project_currentStage_latestEventDate_idx" ON "Project"("currentStage", "latestEventDate");

-- CreateIndex
CREATE INDEX "Project_infillConfidence_latestEventDate_idx" ON "Project"("infillConfidence", "latestEventDate");

-- CreateIndex
CREATE INDEX "Project_reviewStatus_idx" ON "Project"("reviewStatus");

-- CreateIndex
CREATE INDEX "Project_mergedIntoId_idx" ON "Project"("mergedIntoId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEvent_permitEventId_key" ON "ProjectEvent"("permitEventId");

-- CreateIndex
CREATE INDEX "ProjectEvent_projectId_eventDate_idx" ON "ProjectEvent"("projectId", "eventDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectEvent_projectId_permitEventId_key" ON "ProjectEvent"("projectId", "permitEventId");

-- CreateIndex
CREATE INDEX "SavedSearch_userId_isActive_idx" ON "SavedSearch"("userId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "SavedSearch_userId_name_key" ON "SavedSearch"("userId", "name");

-- CreateIndex
CREATE INDEX "SavedSearchNeighbourhood_neighbourhoodId_idx" ON "SavedSearchNeighbourhood"("neighbourhoodId");

-- CreateIndex
CREATE UNIQUE INDEX "AlertEvent_idempotencyKey_key" ON "AlertEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "AlertEvent_savedSearchId_idx" ON "AlertEvent"("savedSearchId");

-- CreateIndex
CREATE INDEX "AlertEvent_projectId_createdAt_idx" ON "AlertEvent"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "AlertEvent_deliveryStatus_createdAt_idx" ON "AlertEvent"("deliveryStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AlertEvent_userId_triggeringPermitEventId_key" ON "AlertEvent"("userId", "triggeringPermitEventId");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_lockKey_key" ON "JobRun"("lockKey");

-- CreateIndex
CREATE INDEX "JobRun_jobType_createdAt_idx" ON "JobRun"("jobType", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_status_createdAt_idx" ON "JobRun"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Address" ADD CONSTRAINT "Address_neighbourhoodId_fkey" FOREIGN KEY ("neighbourhoodId") REFERENCES "Neighbourhood"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawPermitRecord" ADD CONSTRAINT "RawPermitRecord_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportFailure" ADD CONSTRAINT "ImportFailure_importRunId_fkey" FOREIGN KEY ("importRunId") REFERENCES "ImportRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitEvent" ADD CONSTRAINT "PermitEvent_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitEvent" ADD CONSTRAINT "PermitEvent_neighbourhoodId_fkey" FOREIGN KEY ("neighbourhoodId") REFERENCES "Neighbourhood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitEvent" ADD CONSTRAINT "PermitEvent_rawRecordId_fkey" FOREIGN KEY ("rawRecordId") REFERENCES "RawPermitRecord"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_neighbourhoodId_fkey" FOREIGN KEY ("neighbourhoodId") REFERENCES "Neighbourhood"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectEvent" ADD CONSTRAINT "ProjectEvent_permitEventId_fkey" FOREIGN KEY ("permitEventId") REFERENCES "PermitEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearch" ADD CONSTRAINT "SavedSearch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearchNeighbourhood" ADD CONSTRAINT "SavedSearchNeighbourhood_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "SavedSearch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedSearchNeighbourhood" ADD CONSTRAINT "SavedSearchNeighbourhood_neighbourhoodId_fkey" FOREIGN KEY ("neighbourhoodId") REFERENCES "Neighbourhood"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_savedSearchId_fkey" FOREIGN KEY ("savedSearchId") REFERENCES "SavedSearch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertEvent" ADD CONSTRAINT "AlertEvent_triggeringPermitEventId_fkey" FOREIGN KEY ("triggeringPermitEventId") REFERENCES "PermitEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostGIS spatial indexes are maintained in SQL because Prisma does not yet
-- represent indexes over Unsupported geometry columns in the Prisma schema.
CREATE INDEX "Neighbourhood_boundary_gist_idx"
ON "Neighbourhood" USING GIST ("boundary");

CREATE INDEX "Address_location_gist_idx"
ON "Address" USING GIST ("location");

-- Keep confidence values inside the ranges expected by the application.
ALTER TABLE "Address"
ADD CONSTRAINT "Address_geocodingConfidence_range"
CHECK ("geocodingConfidence" IS NULL OR ("geocodingConfidence" >= 0 AND "geocodingConfidence" <= 1));

ALTER TABLE "Project"
ADD CONSTRAINT "Project_infillConfidence_range"
CHECK ("infillConfidence" >= 0 AND "infillConfidence" <= 100);

ALTER TABLE "SavedSearch"
ADD CONSTRAINT "SavedSearch_minConfidenceScore_range"
CHECK ("minConfidenceScore" IS NULL OR ("minConfidenceScore" >= 0 AND "minConfidenceScore" <= 100));

