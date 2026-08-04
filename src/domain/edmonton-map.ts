export const EDMONTON_COORDINATE_LIMITS = {
  west: -114,
  east: -113,
  north: 53.9,
  south: 53.2,
} as const;

export const PROJECT_CLUSTER_THRESHOLD = 50;
export const PROJECT_CLUSTER_MAX_ZOOM = 12;

export function hasUsableEdmontonCoordinates({
  latitude,
  longitude,
}: {
  latitude: number | null;
  longitude: number | null;
}): boolean {
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= EDMONTON_COORDINATE_LIMITS.south &&
    latitude <= EDMONTON_COORDINATE_LIMITS.north &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= EDMONTON_COORDINATE_LIMITS.west &&
    longitude <= EDMONTON_COORDINATE_LIMITS.east
  );
}

export function shouldClusterProjectMarkers(markerCount: number): boolean {
  return markerCount > PROJECT_CLUSTER_THRESHOLD;
}

export function projectFitMaxZoom(markerCount: number): number {
  return shouldClusterProjectMarkers(markerCount) ? 13 : 15;
}
