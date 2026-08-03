import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import coreInfillArea from "../../src/domain/edmonton-core-infill-area.json" with { type: "json" };
import {
  classifyEdmontonCoreInfillArea,
  CORE_INFILL_AREA_POLICY,
  INFILL_AREA_CLASSIFICATION,
} from "../../src/domain/edmonton-core-infill-area";

describe("Edmonton core infill area policy", () => {
  it.each([
    ["Westmount", 53.552234, -113.540089],
    ["Bonnie Doon", 53.524193, -113.466665],
    ["Ritchie", 53.513052, -113.480955],
    ["Highlands", 53.567174, -113.431618],
  ])("classifies %s as core", (_name, latitude, longitude) => {
    expect(classifyEdmontonCoreInfillArea({ latitude, longitude })).toBe(
      INFILL_AREA_CLASSIFICATION.core,
    );
  });

  it.each([
    ["Kildare north of Yellowhead", 53.603005, -113.455994],
    ["Mill Woods Town Centre south of Whitemud", 53.456401, -113.427523],
    ["Twin Brooks south of Whitemud", 53.442734, -113.530384],
    ["Westview Village outside Anthony Henday", 53.553299, -113.696684],
    ["Yellowhead road corridor", 53.58133, -113.47161],
    ["Whitemud road corridor", 53.4828, -113.54833],
  ])("classifies %s as outside the core", (_name, latitude, longitude) => {
    expect(classifyEdmontonCoreInfillArea({ latitude, longitude })).toBe(
      INFILL_AREA_CLASSIFICATION.outsideCore,
    );
  });

  it("treats the frozen polygon boundary as core", () => {
    const [longitude, latitude] = coreInfillArea.geometry.coordinates[0]![0]!;
    expect(classifyEdmontonCoreInfillArea({ latitude, longitude })).toBe(
      INFILL_AREA_CLASSIFICATION.core,
    );
  });

  it.each([
    { latitude: null, longitude: -113.5 },
    { latitude: 53.5, longitude: undefined },
    { latitude: Number.NaN, longitude: -113.5 },
    { latitude: 0, longitude: 0 },
  ])("does not guess when coordinates are absent or implausible", (coordinates) => {
    expect(classifyEdmontonCoreInfillArea(coordinates)).toBe(INFILL_AREA_CLASSIFICATION.unknown);
  });

  it("exposes auditable policy metadata", () => {
    expect(CORE_INFILL_AREA_POLICY).toMatchObject({
      policyVersion: "2026-08-02",
      sourceRoadDatasetId: "9j8t-zm52",
      freewayBufferMetres: 50,
      geometrySha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(createHash("sha256").update(JSON.stringify(coreInfillArea.geometry)).digest("hex")).toBe(
      CORE_INFILL_AREA_POLICY.geometrySha256,
    );
  });
});
