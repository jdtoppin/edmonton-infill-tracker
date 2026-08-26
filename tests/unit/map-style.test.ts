import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_GLYPHS_URL,
  DEFAULT_MAP_TILE_URL,
  EDMONTON_COORDINATE_LIMITS,
  LEGACY_DEFAULT_MAP_TILE_URL,
  resolveMapStyle,
} from "../../components/maps/map-style";

describe("map style configuration", () => {
  it("builds a token-free flat vector style with readable roads and current street labels", () => {
    const style = resolveMapStyle({});

    expect(style).toMatchObject({
      version: 8,
      glyphs: DEFAULT_MAP_GLYPHS_URL,
      sources: {
        "openstreetmap-shortbread": {
          type: "vector",
          tiles: [DEFAULT_MAP_TILE_URL],
          attribution: expect.stringContaining("OpenStreetMap contributors"),
        },
      },
    });
    expect(style).toEqual(
      expect.objectContaining({
        layers: expect.arrayContaining([
          expect.objectContaining({ id: "flat-background", type: "background" }),
          expect.objectContaining({ id: "street-casings", type: "line" }),
          expect.objectContaining({ id: "local-streets", type: "line" }),
          expect.objectContaining({
            id: "street-labels",
            type: "symbol",
            "source-layer": "street_labels",
            layout: expect.objectContaining({ "text-font": ["noto_sans_regular"] }),
          }),
        ]),
      }),
    );
    expect(JSON.stringify(style)).toContain("#bdc8c3");
    expect(JSON.stringify(style)).not.toContain("place_labels");
  });

  it("upgrades the former labelled default to the flat label-free base", () => {
    const style = resolveMapStyle({ mapTileUrl: LEGACY_DEFAULT_MAP_TILE_URL });

    expect(style).toMatchObject({
      sources: {
        "openstreetmap-shortbread": {
          type: "vector",
          tiles: [DEFAULT_MAP_TILE_URL],
          attribution: expect.stringContaining("OpenStreetMap contributors"),
        },
      },
      glyphs: DEFAULT_MAP_GLYPHS_URL,
    });
  });

  it("preserves an explicit custom raster provider without altering its colours", () => {
    const tileUrl = "https://tiles.example.test/{z}/{x}/{y}.png";
    const style = resolveMapStyle({ mapTileUrl: tileUrl });

    expect(style).toMatchObject({
      version: 8,
      sources: {
        "openstreetmap-tiles": {
          type: "raster",
          tiles: [tileUrl],
          attribution: expect.stringContaining("OpenStreetMap contributors"),
        },
      },
      layers: [{ id: "openstreetmap-basemap", type: "raster" }],
    });
    expect(style).not.toMatchObject({ layers: [{ paint: expect.anything() }] });
  });

  it("lets an audited complete style override the raster tile template", () => {
    expect(
      resolveMapStyle({
        mapStyleUrl: "https://maps.example.test/style.json",
        mapTileUrl: "https://tiles.example.test/{z}/{x}/{y}.png",
      }),
    ).toBe("https://maps.example.test/style.json");
  });

  it("uses generous Edmonton sanity limits that contain the city centre and reject swapped coordinates", () => {
    expect(53.5461).toBeGreaterThanOrEqual(EDMONTON_COORDINATE_LIMITS.south);
    expect(53.5461).toBeLessThanOrEqual(EDMONTON_COORDINATE_LIMITS.north);
    expect(-113.4938).toBeGreaterThanOrEqual(EDMONTON_COORDINATE_LIMITS.west);
    expect(-113.4938).toBeLessThanOrEqual(EDMONTON_COORDINATE_LIMITS.east);
    expect(-113.4938).toBeLessThan(EDMONTON_COORDINATE_LIMITS.south);
  });
});
