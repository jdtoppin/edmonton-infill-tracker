# Core infill area policy

The dashboard's **Core infill area** is a tracker-specific analytic boundary. It is not presented as the City of Edmonton's official city-wide definition of infill. The City's official redeveloping-area geography is broader, while this product deliberately focuses dashboard comparisons on the area inside Anthony Henday Drive and between Yellowhead Trail and Whitemud Drive.

Explore remains citywide. The boundary affects dashboard analytics and contributes an explainable project-confidence factor; it does not delete or hide source permit records.

## Version 2026-08-02

The frozen WGS84 polygon is stored at `src/domain/edmonton-core-infill-area.json`. Its metadata records the policy version and SHA-256 geometry checksum.

Source geometry comes from the City of Edmonton [Road Network dataset](https://data.edmonton.ca/Transportation-Infrastructure/Road-Network/9j8t-zm52) (`9j8t-zm52`). The derivation selected these parent road names:

- `ANTHONY HENDAY DRIVE NW`
- `YELLOWHEAD TRAIL NW`
- `WHITEMUD DRIVE NW`

Only `Roadway (Standard)` and `Structure - Overpass` segments were used, avoiding ramps and service/frontage roads. The boundary was generated in Edmonton's metric CRS (EPSG:3776), placed 50 metres inside the freeway centrelines, simplified with a 35-metre topology-preserving tolerance, and transformed to EPSG:4326 for runtime point classification.

The City Plan's separate [Redeveloping Area layer](https://gis.edmonton.ca/arcgishosting/rest/services/Hosted/IIF_Non_Market_Web_Map_Update/FeatureServer/92) is the reason the app calls this narrower product rule “Core infill area” rather than “Edmonton's infill boundary.”

## Runtime rules

- `CORE`: a valid mapped address is covered by the frozen polygon, including its boundary.
- `OUTSIDE_CORE`: the address is plausibly in Edmonton but outside the polygon. The score records a visible −40 factor, so even otherwise perfect 100-point evidence tops out at 60.
- `UNKNOWN`: coordinates are absent, non-finite, or implausible for Edmonton. The app does not guess or apply the outside-area penalty. These projects remain in Explore, are omitted from geographically scoped dashboard totals, and generate a dashboard data-quality notice.

All dashboard project counts, lifecycle milestones, category mix, recent signals, high-confidence projects, and leading neighbourhoods require `CORE`. The migration that introduces the classification queues a complete project reclassification so existing records receive the current policy.

## Changing the boundary

A boundary change requires a reviewed policy version, regenerated geometry and checksum, representative inside/outside/road-edge tests, a scoring review, and a reclassification migration. Runtime requests must never fetch or silently replace the polygon from a live external endpoint.
