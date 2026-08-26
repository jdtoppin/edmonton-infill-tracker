-- Migration 00000000000009 marked these rows for replay, but its one-time
-- PROJECT_MATCHING enqueue could be skipped when another pipeline stage held
-- the unique conflict key. Re-mark only the bounded legacy cohort; the worker
-- startup coordinator durably queues matching after any active terminal
-- reclassification stage has finished.
UPDATE "PermitEvent" AS permit
SET
  "addressNormalizationVersion" = 1,
  "projectMatchStatus" = 'PENDING'::"ProjectMatchStatus"
FROM "Address" AS address
WHERE permit."addressId" = address."id"
  AND (
    address."normalizedStreetAddress" !~* '^[0-9]+[A-Z]{0,2}([[:space:]]+[^[:space:]]+)+[[:space:]]+(ACRES|ALY|AVE|BAY|BEND|BLUFF|BLVD|BRIDGE|CAPE|CENTRE|CIR|CL|COMMON|COVE|CREST|CROSSING|CT|CRES|DR|END|ESTATES|FREEWAY|GARDENS|GATE|GREEN|GROVE|HEATH|HILL|HTS|HWY|KEEP|KEY|LANDING|LANE|LINK|LOOP|MALL|MANOR|MAZE|MEWS|ONE|PARADE|PARK|PASSAGE|PKWY|PL|PLAZA|POINTE|PROMENADE|PT|RD|RISE|ROW|RUN|SQ|ST|STATION|STOP|TER|TRL|TWO|VIEW|VILLAGE|VISTA|WALK|WAY|WYND|WYNDE)([[:space:]]|$)'
    OR address."rawSourceAddress" ~* '^[[:space:]]*[0-9]+[A-Z0-9-]*[[:space:]]*,[[:space:]]*[0-9]+[A-Z]{0,2}[[:space:]]*-[[:space:]]*'
  );
