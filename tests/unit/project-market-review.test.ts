import { describe, expect, it } from "vitest";

import { ProjectCategory } from "../../src/generated/prisma/enums";
import { requiresMarketReview } from "../../src/services/project-intelligence";

const occupancy = new Date("2026-08-01T00:00:00.000Z");

describe("project market-review eligibility", () => {
  it.each([
    ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
    ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
    ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
    ProjectCategory.PROBABLE_DUPLEX,
    ProjectCategory.PROBABLE_ROW_HOUSING,
    ProjectCategory.PROBABLE_GARDEN_SUITE,
  ])("requires review for newly completed residential infill category %s", (category) => {
    expect(requiresMarketReview(category, occupancy, null)).toBe(true);
  });

  it.each([
    ProjectCategory.DEMOLITION_ONLY,
    ProjectCategory.RENOVATION_OR_ADDITION,
    ProjectCategory.UNCERTAIN_RESIDENTIAL_DEVELOPMENT,
    ProjectCategory.NOT_RELEVANT,
  ])("does not queue ineligible category %s", (category) => {
    expect(requiresMarketReview(category, occupancy, null)).toBe(false);
  });

  it("does not repeat review after the latest occupancy was checked", () => {
    expect(requiresMarketReview(ProjectCategory.PROBABLE_DUPLEX, occupancy, occupancy)).toBe(false);
    expect(
      requiresMarketReview(
        ProjectCategory.PROBABLE_DUPLEX,
        occupancy,
        new Date("2026-08-02T00:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
