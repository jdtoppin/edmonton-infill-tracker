import { describe, expect, it } from "vitest";

import {
  calculateInfillConfidenceScore,
  classifyInfillProject,
  INFILL_PROJECT_CATEGORY,
} from "../../src/domain/infill-classification";
import { createInfillScoringConfig } from "../../src/domain/infill-scoring-config";

describe("rule-based infill classification and confidence scoring", () => {
  it("combines related demolition, development, and building events", () => {
    const result = classifyInfillProject({
      neighbourhood: "Westmount",
      events: [
        {
          permitType: "Demolition Permit",
          workDescription: "Demolish the existing single detached house",
          eventDate: "2026-01-01",
        },
        {
          permitType: "Development Permit",
          permitSubtype: "New",
          workDescription: "Construct a new semi-detached dwelling",
          buildingType: "Semi-detached residential",
          unitsAdded: 2,
          constructionValue: 700_000,
          eventDate: "2026-02-15",
        },
        {
          permitType: "Building Permit",
          permitSubtype: "New building",
          workDescription: "New semi-detached dwelling",
          buildingType: "Semi-detached residential",
          unitsAdded: 2,
          constructionValue: 700_000,
          eventDate: "2026-03-01",
        },
      ],
    });

    expect(result.category).toBe(INFILL_PROJECT_CATEGORY.probableSemiDetachedInfill);
    expect(result.confidenceScore).toBe(100);
    expect(result.scoreExplanation.map(({ rule, points }) => [rule, points])).toEqual([
      ["demolitionAtSameAddress", 20],
      ["newResidentialConstruction", 30],
      ["developmentAndBuildingPermit", 15],
      ["newDwellingLanguage", 10],
      ["twoOrMoreUnits", 10],
      ["recognizedResidentialBuildingType", 10],
      ["constructionValueAboveThreshold", 5],
    ]);
    expect(result.timeline).toEqual({
      demolitionToConstructionDays: 45,
      withinConfiguredWindow: true,
    });
    expect(result.plainLanguageExplanation).toContain(
      "Demolition preceded construction by 45 days",
    );
  });

  it("uses dataset provenance to recognize Edmonton permit families with non-generic labels", () => {
    const result = classifyInfillProject({
      events: [
        {
          sourceDataset: "development",
          permitType: "Residential",
          permitSubtype: "New",
          workDescription: "Construct a new semi-detached dwelling",
          buildingType: "Semi-detached residential",
        },
        {
          sourceDataset: "building",
          permitType: "Single, Semi-detached & Rowhousing",
          permitSubtype: "New",
          workDescription: "Construct a new semi-detached dwelling",
          buildingType: "Semi-detached residential",
        },
      ],
    });

    expect(result.category).toBe(INFILL_PROJECT_CATEGORY.probableSemiDetachedInfill);
    expect(result.scoreExplanation).toContainEqual(
      expect.objectContaining({ rule: "developmentAndBuildingPermit", points: 15 }),
    );
  });

  it("does not treat Edmonton's combined job category as the specific housing form", () => {
    const result = classifyInfillProject({
      events: [
        {
          sourceDataset: "building",
          permitType: "Single, Semi-detached & Rowhousing",
          permitSubtype: "(01) Building - New",
          workDescription: "Construct a new single detached dwelling.",
          buildingType: "Single Detached House",
        },
      ],
    });

    expect(result.category).toBe(INFILL_PROJECT_CATEGORY.probableNewDetachedInfill);
  });

  it("classifies supported residential forms", () => {
    const cases = [
      ["Construct a new duplex dwelling", INFILL_PROJECT_CATEGORY.probableDuplex],
      ["Construct new row housing dwellings", INFILL_PROJECT_CATEGORY.probableRowHousing],
      ["Construct a garden suite in the rear yard", INFILL_PROJECT_CATEGORY.probableGardenSuite],
      [
        "Construct a new single detached dwelling",
        INFILL_PROJECT_CATEGORY.probableNewDetachedInfill,
      ],
    ] as const;

    for (const [workDescription, expectedCategory] of cases) {
      expect(
        classifyInfillProject({
          events: [
            {
              permitType: "Building Permit",
              permitSubtype: "New",
              workDescription,
              buildingType: "Residential",
            },
          ],
        }).category,
      ).toBe(expectedCategory);
    }
  });

  it("requires an external signal before claiming a detached project will hit the market", () => {
    const events = [
      {
        permitType: "Building Permit",
        permitSubtype: "New",
        workDescription: "Construct a new single detached dwelling",
        buildingType: "Single Detached House",
      },
    ];

    expect(classifyInfillProject({ events }).category).toBe(
      INFILL_PROJECT_CATEGORY.probableNewDetachedInfill,
    );
    expect(classifyInfillProject({ events, marketListingSignal: true }).category).toBe(
      INFILL_PROJECT_CATEGORY.probableNewDetachedInfillForMarket,
    );
  });

  it("subtracts renovation-only weight and avoids a new-infill false positive", () => {
    const result = classifyInfillProject({
      events: [
        {
          permitType: "Building Permit",
          workDescription: "Interior renovation and rear addition to existing residence",
          buildingType: "Single Detached House",
          constructionValue: 80_000,
        },
      ],
    });

    expect(result.category).toBe(INFILL_PROJECT_CATEGORY.renovationOrAddition);
    expect(result.confidenceScore).toBe(0);
    expect(result.scoreExplanation).toContainEqual(
      expect.objectContaining({ rule: "renovationOnly", points: -25 }),
    );
  });

  it("makes commercial or industrial classification an explicit exclusion", () => {
    const result = classifyInfillProject({
      events: [
        {
          permitType: "Building Permit",
          permitSubtype: "New",
          workDescription: "Construct a new industrial warehouse",
          buildingType: "Industrial",
          unitsAdded: 4,
          constructionValue: 4_000_000,
        },
      ],
    });

    expect(result.category).toBe(INFILL_PROJECT_CATEGORY.notRelevant);
    expect(result.confidenceScore).toBe(0);
    expect(result.scoreExplanation).toEqual([
      {
        rule: "commercialOrIndustrialExclusion",
        points: 0,
        message: "Commercial or industrial language excludes this project from residential infill.",
      },
    ]);
  });

  it("honours scoring configuration overrides without classifier changes", () => {
    const input = {
      events: [
        {
          permitType: "Building Permit",
          permitSubtype: "New",
          workDescription: "Construct a new single detached dwelling",
          buildingType: "Single Detached House",
          constructionValue: 150_000,
        },
      ],
    };
    const config = createInfillScoringConfig({
      highConstructionValueThreshold: 100_000,
      weights: { constructionValueAboveThreshold: 7 },
    });

    expect(calculateInfillConfidenceScore(input, config)).toBe(57);
  });

  it("does not award same-address demolition points to an unverified relation", () => {
    const result = classifyInfillProject({
      events: [
        {
          permitType: "Demolition Permit",
          workDescription: "Demolish existing house",
          sameAddress: false,
          eventDate: "2026-01-01",
        },
        {
          permitType: "Building Permit",
          permitSubtype: "New",
          workDescription: "Construct a new single detached dwelling",
          buildingType: "Single Detached House",
          eventDate: "2026-02-01",
        },
      ],
    });

    expect(result.scoreExplanation.map((item) => item.rule)).not.toContain(
      "demolitionAtSameAddress",
    );
    expect(result.timeline.demolitionToConstructionDays).toBeNull();
  });
});
