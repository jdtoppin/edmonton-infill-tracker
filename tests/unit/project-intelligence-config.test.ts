import { describe, expect, it } from "vitest";

import {
  configuredInfillScoringConfig,
  InfillScoringConfigError,
} from "../../src/domain/infill-scoring-config";

describe("configured infill scoring policy", () => {
  it("defaults to an 18-month maximum episode gap", () => {
    expect(configuredInfillScoringConfig({}).maxEpisodeGapDays).toBe(548);
  });

  it("supports the more aggressive roughly 15-month policy", () => {
    expect(
      configuredInfillScoringConfig({ INFILL_EPISODE_GAP_DAYS: "457" }).maxEpisodeGapDays,
    ).toBe(457);
  });

  it("rejects invalid episode windows instead of silently changing scoring", () => {
    expect(() => configuredInfillScoringConfig({ INFILL_EPISODE_GAP_DAYS: "0" })).toThrow(
      InfillScoringConfigError,
    );
    expect(() => configuredInfillScoringConfig({ INFILL_EPISODE_GAP_DAYS: "548.5" })).toThrow(
      /integer from 1 through 3650/,
    );
  });
});
