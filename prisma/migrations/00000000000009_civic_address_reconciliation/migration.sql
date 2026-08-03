-- Edmonton Open Data formats civic addresses as `5308 - 103A AVENUE NW`.
-- Address normalization v1 incorrectly treated the building number as a unit,
-- allowing separate properties on the same street to be grouped together.
CREATE TYPE "ProjectMatchStatus" AS ENUM ('PENDING', 'MATCHED', 'UNMATCHABLE');

ALTER TABLE "PermitEvent"
ADD COLUMN "addressNormalizationVersion" INTEGER NOT NULL DEFAULT 2,
ADD COLUMN "projectMatchStatus" "ProjectMatchStatus" NOT NULL DEFAULT 'PENDING';

UPDATE "PermitEvent" AS permit
SET "projectMatchStatus" = 'MATCHED'::"ProjectMatchStatus"
WHERE EXISTS (
  SELECT 1
  FROM "ProjectEvent" AS link
  WHERE link."permitEventId" = permit."id"
);

-- Limit the one-time repair queue to addresses that do not currently contain
-- both a civic number and a distinct street name/number before the street type.
-- This catches the street-only result of the v1 bug (`103A AVE NW`) and other
-- incomplete legacy keys without rewriting hundreds of thousands of unaffected
-- permit rows on a small local host.
UPDATE "PermitEvent" AS permit
SET "addressNormalizationVersion" = 1
FROM "Address" AS address
WHERE permit."addressId" = address."id"
  AND (
    address."normalizedStreetAddress" !~* '^[0-9]+[A-Z]{0,2}([[:space:]]+[^[:space:]]+)+[[:space:]]+(ACRES|ALY|AVE|BAY|BEND|BLUFF|BLVD|BRIDGE|CAPE|CENTRE|CIR|CL|COMMON|COVE|CREST|CROSSING|CT|CRES|DR|END|ESTATES|FREEWAY|GARDENS|GATE|GREEN|GROVE|HEATH|HILL|HTS|HWY|KEEP|KEY|LANDING|LANE|LINK|LOOP|MALL|MANOR|MAZE|MEWS|ONE|PARADE|PARK|PASSAGE|PKWY|PL|PLAZA|POINTE|PROMENADE|PT|RD|RISE|ROW|RUN|SQ|ST|STATION|STOP|TER|TRL|TWO|VIEW|VILLAGE|VISTA|WALK|WAY|WYND|WYNDE)([[:space:]]|$)'
    -- Numeric comma-prefixed units looked complete under v1 (`317 12025
    -- 48 AVE`) and therefore need an explicit repair trigger.
    OR address."rawSourceAddress" ~* '^[[:space:]]*[0-9]+[A-Z0-9-]*[[:space:]]*,[[:space:]]*[0-9]+[A-Z]{0,2}[[:space:]]*-[[:space:]]*'
  );

CREATE INDEX "PermitEvent_addressNormalizationVersion_id_idx"
ON "PermitEvent"("addressNormalizationVersion", "id");

CREATE INDEX "PermitEvent_projectMatchStatus_id_idx"
ON "PermitEvent"("projectMatchStatus", "id");

-- The current matching job first re-normalizes every legacy event from its raw
-- source payload, then safely rematches any automatically linked event whose
-- corrected civic site differs. Reuse the pipeline conflict key so repair,
-- import, matching, and reclassification cannot overlap.
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
  'migration-00000000000009-civic-address-reconciliation',
  'PROJECT_MATCHING'::"JobType",
  'PENDING'::"RunStatus",
  'job:permit-project-pipeline',
  '{"reason":"reconcile-civic-addresses","addressNormalizationVersion":2,"migration":"00000000000009_civic_address_reconciliation"}'::jsonb,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT DO NOTHING;
