import type { MapOptions } from "maplibre-gl";

export { EDMONTON_COORDINATE_LIMITS } from "../../src/domain/edmonton-map";

export const EDMONTON_CENTER: [longitude: number, latitude: number] = [-113.4938, 53.5461];

// Keep the old default recognizable so existing local .env files receive this
// updated presentation without a manual configuration migration.
export const LEGACY_DEFAULT_MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const DEFAULT_MAP_TILE_URL =
  "https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt";
export const DEFAULT_MAP_GLYPHS_URL =
  "https://vector.openstreetmap.org/styles/shortbread/fonts/{fontstack}/{range}.pbf";
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
      glyphs: DEFAULT_MAP_GLYPHS_URL,
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
          id: "street-casings",
          type: "line",
          source: "openstreetmap-shortbread",
          "source-layer": "streets",
          filter: [
            "!",
            ["in", ["get", "kind"], ["literal", ["rail", "light_rail", "tram", "funicular"]]],
          ],
          paint: {
            "line-color": "#bdc8c3",
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.62, 10, 0.82, 14, 1],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.7, 10, 1.9, 14, 4.8],
          },
        },
        {
          id: "local-streets",
          type: "line",
          source: "openstreetmap-shortbread",
          "source-layer": "streets",
          filter: [
            "!",
            ["in", ["get", "kind"], ["literal", ["rail", "light_rail", "tram", "funicular"]]],
          ],
          paint: {
            "line-color": [
              "case",
              ["in", ["get", "kind"], ["literal", ["motorway", "trunk", "primary"]]],
              "#d5b87a",
              ["in", ["get", "kind"], ["literal", ["secondary", "tertiary"]]],
              "#f1f3ee",
              "#ffffff",
            ],
            "line-opacity": ["interpolate", ["linear"], ["zoom"], 5, 0.82, 10, 0.96, 14, 1],
            "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.35, 10, 1.15, 14, 3.5],
          },
        },
        {
          id: "street-labels",
          type: "symbol",
          source: "openstreetmap-shortbread",
          "source-layer": "street_labels",
          minzoom: 11,
          filter: ["has", "name"],
          layout: {
            "symbol-placement": "line",
            "text-field": ["get", "name"],
            "text-font": ["noto_sans_regular"],
            "text-size": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 13],
            "text-max-angle": 35,
            "text-padding": 2,
            "text-keep-upright": true,
          },
          paint: {
            "text-color": "#536360",
            "text-halo-color": "rgba(248, 250, 246, 0.96)",
            "text-halo-width": 1.4,
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
