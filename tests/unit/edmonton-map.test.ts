import { describe, expect, it } from "vitest";

import {
  hasUsableEdmontonCoordinates,
  PROJECT_CLUSTER_MAX_ZOOM,
  PROJECT_CLUSTER_THRESHOLD,
  projectFitMaxZoom,
  shouldClusterProjectMarkers,
} from "../../src/domain/edmonton-map";

describe("Edmonton project map policy", () => {
  it("keeps small filtered result sets as individual projects", () => {
    expect(shouldClusterProjectMarkers(3)).toBe(false);
    expect(shouldClusterProjectMarkers(PROJECT_CLUSTER_THRESHOLD)).toBe(false);
    expect(projectFitMaxZoom(3)).toBe(15);
  });

  it("clusters large result sets only until neighbourhood-level zoom", () => {
    expect(shouldClusterProjectMarkers(PROJECT_CLUSTER_THRESHOLD + 1)).toBe(true);
    expect(PROJECT_CLUSTER_MAX_ZOOM).toBe(12);
    expect(projectFitMaxZoom(PROJECT_CLUSTER_THRESHOLD + 1)).toBe(13);
  });

  it("accepts only finite coordinates inside the Edmonton sanity envelope", () => {
    expect(hasUsableEdmontonCoordinates({ latitude: 53.5461, longitude: -113.4938 })).toBe(true);
    expect(hasUsableEdmontonCoordinates({ latitude: null, longitude: -113.4938 })).toBe(false);
    expect(hasUsableEdmontonCoordinates({ latitude: 53.5461, longitude: Number.NaN })).toBe(false);
    expect(hasUsableEdmontonCoordinates({ latitude: -113.4938, longitude: 53.5461 })).toBe(false);
    expect(hasUsableEdmontonCoordinates({ latitude: 54, longitude: -113.4938 })).toBe(false);
  });
});
