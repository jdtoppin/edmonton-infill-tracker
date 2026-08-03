import type { MapOptions } from "maplibre-gl";

export const EDMONTON_CENTER: [longitude: number, latitude: number] = [-113.4938, 53.5461];

// A deliberately generous sanity envelope for City-sourced coordinates. The map
// fits the actual result points, so this is validation rather than a viewport.
export const EDMONTON_COORDINATE_LIMITS = {
  west: -114,
  east: -113,
  north: 53.9,
  south: 53.2,
} as const;

export const DEFAULT_MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_MAP_RASTER_PAINT = {
  "raster-saturation": -0.45,
  "raster-contrast": -0.08,
  "raster-brightness-min": 0.08,
  "raster-brightness-max": 0.96,
  "raster-opacity": 0.94,
  "raster-fade-duration": 100,
} as const;

type MapStyle = NonNullable<MapOptions["style"]>;

export function resolveMapStyle({
  mapStyleUrl,
  mapTileUrl,
}: {
  mapStyleUrl?: string | null;
  mapTileUrl?: string | null;
}): MapStyle {
  const configuredStyle = mapStyleUrl?.trim();
  if (configuredStyle) return configuredStyle;

  const configuredTile = mapTileUrl?.trim();
  const tileUrl = configuredTile || DEFAULT_MAP_TILE_URL;
  const usesDefaultTiles = !configuredTile || configuredTile === DEFAULT_MAP_TILE_URL;

  return {
    version: 8,
    sources: {
      "openstreetmap-tiles": {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
        maxzoom: 19,
        attribution:
          '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
      },
    },
    layers: [
      {
        id: "openstreetmap-basemap",
        type: "raster",
        source: "openstreetmap-tiles",
        minzoom: 0,
        ...(usesDefaultTiles ? { paint: DEFAULT_MAP_RASTER_PAINT } : {}),
      },
    ],
  };
}
