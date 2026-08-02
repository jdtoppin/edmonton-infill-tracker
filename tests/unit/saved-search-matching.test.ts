import { describe, expect, it } from "vitest";

import {
  evaluateSavedSearchMatch,
  matchesSavedSearch,
} from "../../src/domain/saved-search-matching";

describe("saved-search matching", () => {
  const project = {
    neighbourhoodId: "1150",
    neighbourhoodName: "Westmount",
    category: "probable-duplex",
    constructionValue: 650_000,
    units: 2,
    confidenceScore: 85,
    stage: "Building Permit Issued",
  };

  it("matches every configured filter with inclusive numeric boundaries", () => {
    expect(
      matchesSavedSearch(
        {
          active: true,
          selectedNeighbourhoods: ["westmount"],
          projectCategories: ["Probable Duplex"],
          minimumConstructionValue: 650_000,
          maximumConstructionValue: 650_000,
          minimumUnits: 2,
          maximumUnits: 2,
          minimumConfidenceScore: 85,
          stages: ["building-permit-issued"],
        },
        project,
      ),
    ).toBe(true);
  });

  it("matches a neighbourhood by city identifier as well as by name", () => {
    expect(matchesSavedSearch({ neighbourhoodIds: [1150] }, project)).toBe(true);
  });

  it("accepts persistence-shaped field names without importing the ORM", () => {
    expect(
      matchesSavedSearch(
        {
          isActive: true,
          neighbourhoodIds: ["1150"],
          projectCategories: ["PROBABLE_DUPLEX"],
          minConstructionValue: 600_000,
          maxConstructionValue: 700_000,
          minUnits: 2,
          maxUnits: 2,
          minConfidenceScore: 80,
          projectStages: ["BUILDING_PERMIT"],
          permitStatuses: ["Issued"],
        },
        {
          neighbourhoodId: "1150",
          projectCategory: "PROBABLE_DUPLEX",
          estimatedConstructionValue: 650_000,
          estimatedUnits: 2,
          infillConfidence: 85,
          currentStage: "BUILDING_PERMIT",
          latestPermitStatus: "ISSUED",
        },
      ),
    ).toBe(true);
  });

  it("reports all failed criteria, including missing constrained values", () => {
    const evaluation = evaluateSavedSearchMatch(
      {
        selectedNeighbourhoods: ["Oliver"],
        projectCategories: ["probable-row-housing"],
        minimumConstructionValue: 1,
        minimumUnits: 1,
        minimumConfidenceScore: 1,
        stages: ["Application"],
      },
      {
        neighbourhoodName: "Westmount",
        category: "probable-duplex",
        stage: "Issued",
      },
    );

    expect(evaluation).toEqual({
      matches: false,
      mismatches: [
        "neighbourhood",
        "category",
        "construction-value",
        "units",
        "confidence-score",
        "stage",
      ],
    });
  });

  it("treats empty selections as wildcards but never matches a paused search", () => {
    expect(
      matchesSavedSearch(
        { selectedNeighbourhoods: [], projectCategories: [], stages: [] },
        project,
      ),
    ).toBe(true);
    expect(matchesSavedSearch({ active: false }, project)).toBe(false);
  });
});
