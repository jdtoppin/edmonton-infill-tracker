import coreInfillArea from "./edmonton-core-infill-area.json" with { type: "json" };

export const INFILL_AREA_CLASSIFICATION = {
  core: "CORE",
  outsideCore: "OUTSIDE_CORE",
  unknown: "UNKNOWN",
} as const;

export type InfillAreaClassification =
  (typeof INFILL_AREA_CLASSIFICATION)[keyof typeof INFILL_AREA_CLASSIFICATION];

export const CORE_INFILL_AREA_POLICY = coreInfillArea.properties;

type Position = readonly [longitude: number, latitude: number];
type LinearRing = readonly Position[];
type PolygonCoordinates = readonly LinearRing[];

const polygons: readonly PolygonCoordinates[] =
  coreInfillArea.geometry.type === "Polygon"
    ? ([coreInfillArea.geometry.coordinates] as unknown as readonly PolygonCoordinates[])
    : (coreInfillArea.geometry.coordinates as unknown as readonly PolygonCoordinates[]);

const edmontonCoordinateEnvelope = {
  minimumLatitude: 53.3,
  maximumLatitude: 53.8,
  minimumLongitude: -113.8,
  maximumLongitude: -113.2,
} as const;

type RingPosition = "inside" | "outside" | "boundary";

function pointOnSegment(point: Position, start: Position, end: Position): boolean {
  const [longitude, latitude] = point;
  const [startLongitude, startLatitude] = start;
  const [endLongitude, endLatitude] = end;
  const crossProduct =
    (latitude - startLatitude) * (endLongitude - startLongitude) -
    (longitude - startLongitude) * (endLatitude - startLatitude);
  if (Math.abs(crossProduct) > 1e-10) return false;

  return (
    longitude >= Math.min(startLongitude, endLongitude) - 1e-10 &&
    longitude <= Math.max(startLongitude, endLongitude) + 1e-10 &&
    latitude >= Math.min(startLatitude, endLatitude) - 1e-10 &&
    latitude <= Math.max(startLatitude, endLatitude) + 1e-10
  );
}

function locatePointInRing(point: Position, ring: LinearRing): RingPosition {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const start = ring[previous]!;
    const end = ring[index]!;
    if (pointOnSegment(point, start, end)) return "boundary";

    const crossesLatitude = start[1] > point[1] !== end[1] > point[1];
    if (!crossesLatitude) continue;
    const crossingLongitude =
      ((end[0] - start[0]) * (point[1] - start[1])) / (end[1] - start[1]) + start[0];
    if (point[0] < crossingLongitude) inside = !inside;
  }
  return inside ? "inside" : "outside";
}

function polygonCovers(point: Position, polygon: PolygonCoordinates): boolean {
  const exterior = polygon[0];
  if (!exterior || locatePointInRing(point, exterior) === "outside") return false;

  return polygon.slice(1).every((hole) => locatePointInRing(point, hole) !== "inside");
}

/**
 * Classifies a mapped Edmonton address against the versioned tracker policy.
 * Bad or absent coordinates remain unknown instead of receiving a location penalty.
 */
export function classifyEdmontonCoreInfillArea(input: {
  latitude: number | null | undefined;
  longitude: number | null | undefined;
}): InfillAreaClassification {
  const { latitude, longitude } = input;
  if (
    latitude === null ||
    latitude === undefined ||
    longitude === null ||
    longitude === undefined ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < edmontonCoordinateEnvelope.minimumLatitude ||
    latitude > edmontonCoordinateEnvelope.maximumLatitude ||
    longitude < edmontonCoordinateEnvelope.minimumLongitude ||
    longitude > edmontonCoordinateEnvelope.maximumLongitude
  ) {
    return INFILL_AREA_CLASSIFICATION.unknown;
  }

  const point: Position = [longitude, latitude];
  return polygons.some((polygon) => polygonCovers(point, polygon))
    ? INFILL_AREA_CLASSIFICATION.core
    : INFILL_AREA_CLASSIFICATION.outsideCore;
}
