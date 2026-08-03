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

// Keep the old default recognizable so existing local .env files receive the
// updated label-free presentation without a manual configuration migration.
export const LEGACY_DEFAULT_MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_MAP_TILE_URL =
  "https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt";
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
  const usesDefaultTiles =
    !configuredTile ||
    configuredTile === DEFAULT_MAP_TILE_URL ||
    configuredTile === LEGACY_DEFAULT_MAP_TILE_URL;
  if (usesDefaultTiles) {
    return {
      version: 8,
      sources: {
        "openstreetmap-shortbread": {
          type: "vector",
          tiles: [DEFAULT_MAP_TILE_URL],
          minzoom: 0,
          maxzoom: 14,
          attribution:
            '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
        },
      },
      layers: [
        {
          id: "flat-background",
          type: "background",
          paint: { "background-color": "#f3f5f1" },
        },
        {
          id: "ocean",
          type: "fill",
          source: "openstreetmap-shortbread",
          "source-layer": "ocean",
          paint: { "fill-color": "#d9e7e5" },
        },
        {
          id: "land",
          type: "fill",
          source: "openstreetmap-shortbread",
          "source-layer": "land",
          paint: { "fill-color": "#e7ede3", "fill-opacity": 0.72 },
        },
        {
          id: "water",
          type: "fill",
          source: "openstreetmap-shortbread",
          "source-layer": "water_polygons",
          paint: { "fill-color": "#cbdedc" },
        },
        {
          id: "sites",
          type: "fill",
          source: "openstreetmap-shortbread",
          "source-layer": "sites",
          minzoom: 13,
          paint: { "fill-color": "#dde7d8", "fill-opacity": 0.68 },
        },
        {
          id: "street-areas",
          type: "fill",
          source: "openstreetmap-shortbread",
          "source-layer": "street_polygons",
          minzoom: 11,
          paint: { "fill-color": "#fbfcfa" },
        },
        {
          id: "buildings",
          type: "fill",
          source: "openstreetmap-shortbread",
          "source-layer": "buildings",
          minzoom: 13.5,
          paint: {
            "fill-color": "#d9ddda",
            "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13.5, 0.35, 16, 0.72],
          },
        },
        {
          id: "administrative-boundaries",
          type: "line",
          source: "openstreetmap-shortbread",
          "source-layer": "boundaries",
          paint: {
            "line-color": "#aebbb8",
            "line-opacity": 0.45,
            "line-width": 0.8,
            "line-dasharray": [3, 3],
          },
        },
        {
          id: "local-streets",
          type: "line",
          source: "openstreetmap-shortbread",
          "source-layer": "streets",
          paint: {
            "line-color": [
              "case",
              ["in", ["get", "kind"], ["literal", ["motorway", "trunk", "primary"]]],
              "#c7c9c1",
              "#ffffff",
            ],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.4, 10, 0.72, 14, 0.98],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.25, 10, 0.8, 14, 2.2],
          },
        },
      ],
    };
  }

  return {
    version: 8,
    sources: {
      "openstreetmap-tiles": {
        type: "raster",
        tiles: [configuredTile!],
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
      },
    ],
  };
}
