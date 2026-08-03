CREATE TYPE "NeighbourhoodNameSource" AS ENUM ('PERMIT', 'CITY_CURRENT_CENTROIDS');

ALTER TABLE "Neighbourhood"
ADD COLUMN "nameSource" "NeighbourhoodNameSource" NOT NULL DEFAULT 'PERMIT',
ADD COLUMN "nameSourceUpdatedAt" TIMESTAMPTZ(3);
