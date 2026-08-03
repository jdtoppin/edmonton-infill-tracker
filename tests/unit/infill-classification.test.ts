import { describe, expect, it } from "vitest";

import {
  assessInfillPermitEvent,
  calculateInfillConfidenceScore,
  classifyInfillProject,
  INFILL_EVENT_ROLE,
  INFILL_PROJECT_CATEGORY,
} from "../../src/domain/infill-classification";
import { createInfillScoringConfig } from "../../src/domain/infill-scoring-config";
import { INFILL_AREA_CLASSIFICATION } from "../../src/domain/edmonton-core-infill-area";

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

  it("caps otherwise perfect outside-core evidence below high-confidence reporting", () => {
    const events = [
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
    ] as const;

    const outside = classifyInfillProject({
      events,
      infillAreaClassification: INFILL_AREA_CLASSIFICATION.outsideCore,
    });
    expect(outside.confidenceScore).toBe(60);
    expect(outside.scoreExplanation).toContainEqual(
      expect.objectContaining({ rule: "outsideCoreInfillArea", points: -40 }),
    );
    expect(outside.plainLanguageExplanation).toContain("outside the tracker's 2026-08-02 core");

    expect(
      classifyInfillProject({
        events,
        infillAreaClassification: INFILL_AREA_CLASSIFICATION.core,
      }).confidenceScore,
    ).toBe(100);
    expect(
      classifyInfillProject({
        events,
        infillAreaClassification: INFILL_AREA_CLASSIFICATION.unknown,
      }).confidenceScore,
    ).toBe(100);
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

  it("does not treat Edmonton's Other status as inactive when the permit is residential", () => {
    const permit = {
      sourceDataset: "development",
      permitType: "Residential",
      permitSubtype: "Discretionary Development",
      status: "Other",
      workDescription:
        "To construct a Residential Use building in the form of a Single Detached House with a front attached Garage.",
      buildingType: "Single Detached House",
      issueDate: "2026-06-24",
    } as const;

    expect(assessInfillPermitEvent(permit).role).toBe(INFILL_EVENT_ROLE.principalResidential);
    expect(classifyInfillProject({ events: [permit] }).category).toBe(
      INFILL_PROJECT_CATEGORY.probableNewDetachedInfill,
    );
  });

  it("uses new-construction evidence, not a demolished building, to select housing form", () => {
    const result = classifyInfillProject({
      events: [
        {
          permitType: "Demolition Permit",
          workDescription: "To demolish an existing duplex.",
          issueDate: "2026-01-02",
        },
        {
          permitType: "Building Permit",
          workDescription: "To construct a new single detached dwelling.",
          buildingType: "Single Detached House",
          issueDate: "2026-02-02",
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

  it("does not reactivate historic infill for the undated 7632 92 Ave garage record", () => {
    const events = [
      {
        sourceDataset: "development",
        permitType: "Demolition Permit",
        status: "Approved",
        workDescription:
          "To demolish an existing Single Detached House and Accessory Building (rear detached Garage).",
        issueDate: "2015-08-07",
      },
      {
        sourceDataset: "building",
        permitType: "House Combo Permit",
        status: "Issued",
        workDescription: "To demolish an existing Single Detached House.",
        issueDate: "2016-03-23",
      },
      {
        sourceDataset: "building",
        permitType: "Other Miscellaneous Building",
        status: "Issued",
        workDescription: "To demolish an existing detached Garage.",
        issueDate: "2016-03-23",
      },
      {
        sourceDataset: "development",
        permitType: "House Combo Permit",
        status: "Approved",
        workDescription: "To construct a Single Detached House with an attached Garage.",
        buildingType: "Single Detached House",
        issueDate: "2016-06-16",
      },
      {
        sourceDataset: "building",
        permitType: "Single, Semi-detached & Rowhousing",
        permitSubtype: "(01) Building - New",
        status: "Issued",
        workDescription: "To construct a Single Detached House with an attached Garage.",
        buildingType: "Single Detached House",
        unitsAdded: 1,
        constructionValue: 351_120,
        issueDate: "2016-06-16",
      },
      {
        sourceDataset: "building",
        permitType: "Heating and Ventilation",
        status: "Issued",
        workDescription:
          "To install an air conditioner in a Single Detached House, existing without permits.",
        buildingType: "Single Detached House",
        issueDate: "2018-07-03",
      },
      {
        sourceDataset: "development",
        permitType: "Accessory Building Combo Permit",
        status: "Other",
        workDescription: "To construct an Accessory Building (mutual Garage, 6.71m x 7.01m).",
        observedAt: "2026-08-02T13:30:04.486Z",
      },
    ] as const;

    const result = classifyInfillProject({ events });
    const assessments = events.map((event) => assessInfillPermitEvent(event));

    expect(assessments.map(({ role }) => role)).toEqual([
      INFILL_EVENT_ROLE.principalDemolition,
      INFILL_EVENT_ROLE.principalDemolition,
      INFILL_EVENT_ROLE.propertyOnly,
      INFILL_EVENT_ROLE.principalResidential,
      INFILL_EVENT_ROLE.principalResidential,
      INFILL_EVENT_ROLE.propertyOnly,
      INFILL_EVENT_ROLE.propertyOnly,
    ]);
    expect(result.episode.events).toHaveLength(4);
    expect(result.episode.infillStartDate?.toISOString().slice(0, 10)).toBe("2015-08-07");
    expect(result.episode.latestInfillActivityDate?.toISOString().slice(0, 10)).toBe("2016-06-16");
    expect(result.category).toBe(INFILL_PROJECT_CATEGORY.probableNewDetachedInfill);
    expect(result.confidenceScore).toBe(80);
    expect(result.scoreExplanation).toContainEqual(
      expect.objectContaining({ rule: "developmentAndBuildingPermit" }),
    );
  });

  it("excludes standalone garages but preserves dwelling and garden-suite garage projects", () => {
    const standaloneGarage = {
      sourceDataset: "development",
      permitType: "Accessory Building Combo Permit",
      status: "Permitted Development",
      workDescription: "Construct a new detached garage.",
      issueDate: "2026-08-02",
    };
    expect(assessInfillPermitEvent(standaloneGarage).role).toBe(INFILL_EVENT_ROLE.propertyOnly);
    expect(classifyInfillProject({ events: [standaloneGarage] })).toMatchObject({
      category: INFILL_PROJECT_CATEGORY.notRelevant,
      confidenceScore: 0,
    });
    expect(
      assessInfillPermitEvent({
        permitType: "Home Improvement Permit",
        workDescription: "Construct a deck to an existing Single Detached House.",
        issueDate: "2026-08-02",
      }).role,
    ).toBe(INFILL_EVENT_ROLE.propertyOnly);

    const houseWithGarage = {
      sourceDataset: "building",
      permitType: "Building Permit",
      permitSubtype: "New",
      status: "Issued",
      workDescription: "Construct a new single detached house with an attached garage.",
      buildingType: "Single Detached House",
      unitsAdded: 1,
      issueDate: "2026-08-02",
    };
    expect(assessInfillPermitEvent(houseWithGarage).role).toBe(
      INFILL_EVENT_ROLE.principalResidential,
    );
    expect(classifyInfillProject({ events: [houseWithGarage] }).category).toBe(
      INFILL_PROJECT_CATEGORY.probableNewDetachedInfill,
    );
    expect(
      assessInfillPermitEvent({
        ...houseWithGarage,
        workDescription: "Construct a Single Detached House with an attached garage.",
        unitsAdded: null,
      }).role,
    ).toBe(INFILL_EVENT_ROLE.principalResidential);
    expect(
      assessInfillPermitEvent({
        ...houseWithGarage,
        sourceDataset: "development",
        workDescription:
          "To construct a Residential Use building in the form of a Single Detached House with a front attached Garage.",
        unitsAdded: null,
      }).role,
    ).toBe(INFILL_EVENT_ROLE.principalResidential);

    const gardenSuiteGarage = {
      sourceDataset: "building",
      permitType: "Building Permit",
      permitSubtype: "New",
      status: "Issued",
      workDescription: "Construct a garden suite above a detached garage.",
      buildingType: "Garden Suite",
      unitsAdded: 1,
      issueDate: "2026-08-02",
    };
    expect(assessInfillPermitEvent(gardenSuiteGarage).role).toBe(
      INFILL_EVENT_ROLE.principalResidential,
    );
    expect(classifyInfillProject({ events: [gardenSuiteGarage] }).category).toBe(
      INFILL_PROJECT_CATEGORY.probableGardenSuite,
    );
  });

  it("keeps garage additions and existing-house additions out of new-infill scoring", () => {
    const garageAddition = {
      sourceDataset: "building",
      permitType: "Other Miscellaneous Building",
      permitSubtype: "(02) Addition",
      status: "Issued",
      workDescription:
        "To construct an addition (two-Storey, with garage on main Floor and living space on second floor) to an existing Single Detached House. Basement development (NOT to be used as an additional Dwelling).",
      buildingType: "Detached Garage (010)",
      unitsAdded: 1,
      issueDate: "2019-03-05",
    } as const;
    expect(assessInfillPermitEvent(garageAddition).role).toBe(INFILL_EVENT_ROLE.propertyOnly);
    expect(classifyInfillProject({ events: [garageAddition] })).toMatchObject({
      category: INFILL_PROJECT_CATEGORY.notRelevant,
      confidenceScore: 0,
    });

    const existingHouseAddition = {
      sourceDataset: "building",
      permitType: "Building Permit",
      permitSubtype: "(02) Addition",
      status: "Issued",
      workDescription: "To construct an addition to an existing Single Detached House.",
      buildingType: "Single Detached House",
      issueDate: "2026-02-01",
    } as const;
    expect(assessInfillPermitEvent(existingHouseAddition).role).toBe(
      INFILL_EVENT_ROLE.residentialSupporting,
    );
    expect(classifyInfillProject({ events: [existingHouseAddition] }).category).toBe(
      INFILL_PROJECT_CATEGORY.renovationOrAddition,
    );

    expect(
      assessInfillPermitEvent({
        sourceDataset: "development",
        permitType: "Accessory Building Combo Permit",
        workDescription:
          "To construct an Accessory Building (new detached Garage) to an existing Single Detached House.",
        issueDate: "2026-03-01",
      }).role,
    ).toBe(INFILL_EVENT_ROLE.propertyOnly);
  });

  it("does not infer a new house from an accessory demolition combination", () => {
    const event = {
      sourceDataset: "development",
      permitType: "Development Permit",
      workDescription:
        "To construct an Accessory Building (rear detached Garage) and demolish an existing Single Detached House.",
      issueDate: "2026-03-01",
    } as const;

    expect(assessInfillPermitEvent(event).role).toBe(INFILL_EVENT_ROLE.principalDemolition);
    const result = classifyInfillProject({ events: [event] });
    expect(result.category).toBe(INFILL_PROJECT_CATEGORY.demolitionOnly);
    expect(result.scoreExplanation.map(({ rule }) => rule)).not.toContain(
      "newResidentialConstruction",
    );
  });

  it("retains both signals when one City permit combines demolition and a new house", () => {
    const assessment = assessInfillPermitEvent({
      sourceDataset: "development",
      permitType: "Residential",
      workDescription:
        "To demolish an existing Single Detached House and construct a new Single Detached House with an attached Garage.",
      issueDate: "2026-03-01",
    });

    expect(assessment).toMatchObject({
      role: INFILL_EVENT_ROLE.principalDemolition,
      demolition: true,
      newResidentialConstruction: true,
    });
  });

  it("recognizes constructed garage suites and Backyard Houses without accepting removed suites", () => {
    const legacyGarageSuite = {
      sourceDataset: "building",
      permitType: "Single, Semi-detached & Rowhousing",
      permitSubtype: "(01) Building - New",
      workDescription: "To construct a Garage Suite.",
      buildingType: "Backyard House (110)",
      unitsAdded: 1,
      issueDate: "2026-07-20",
    } as const;
    const backyardHouse = {
      sourceDataset: "development",
      permitType: "Residential",
      workDescription:
        "To construct a Residential Use building in the form of a Backyard House (1 Dwelling with Garage).",
      issueDate: "2026-07-23",
    } as const;

    for (const event of [legacyGarageSuite, backyardHouse]) {
      expect(assessInfillPermitEvent(event).role).toBe(INFILL_EVENT_ROLE.principalResidential);
      expect(classifyInfillProject({ events: [event] }).category).toBe(
        INFILL_PROJECT_CATEGORY.probableGardenSuite,
      );
    }

    const removedSuite = {
      sourceDataset: "building",
      permitType: "Other Miscellaneous Building",
      workDescription: "Detached garage, Garage Suite removed 304223416-001.",
      buildingType: "Detached Garage (010)",
      unitsAdded: 1,
      issueDate: "2026-07-24",
    } as const;
    expect(assessInfillPermitEvent(removedSuite).role).toBe(INFILL_EVENT_ROLE.propertyOnly);

    const combinedSuite = {
      sourceDataset: "development",
      permitType: "Residential",
      workDescription:
        "To construct a 2 Storey Accessory Building (Garage Suite on 2nd floor, Garage on main floor) and to demolish an existing Accessory Building.",
      unitsAdded: 1,
      issueDate: "2026-07-25",
    } as const;
    expect(assessInfillPermitEvent(combinedSuite)).toMatchObject({
      role: INFILL_EVENT_ROLE.principalDemolition,
      demolition: true,
      newResidentialConstruction: true,
    });
    expect(classifyInfillProject({ events: [combinedSuite] }).category).toBe(
      INFILL_PROJECT_CATEGORY.probableGardenSuite,
    );
  });

  it("recognizes quantified row-house construction even when the project includes garages", () => {
    const descriptions = [
      "To construct a Residential Use building in the form of a 7 Dwelling Row House development and detached Garage.",
      "To construct 4 Dwellings of Row Housing and a mutual detached Garage.",
      "To construct a 4 Dwelling unit Row House with front attached Garage.",
      "To construct a Residential Use 3 Dwelling Row House with a front attached Garage.",
    ];

    for (const workDescription of descriptions) {
      const event = {
        sourceDataset: "development",
        permitType: "Residential",
        status: "Other",
        workDescription,
        issueDate: "2026-06-24",
      } as const;
      expect(assessInfillPermitEvent(event).role).toBe(INFILL_EVENT_ROLE.principalResidential);
      expect(classifyInfillProject({ events: [event] }).category).toBe(
        INFILL_PROJECT_CATEGORY.probableRowHousing,
      );
    }
  });

  it("recognizes Edmonton Cluster Housing as principal residential construction", () => {
    const event = {
      sourceDataset: "development",
      permitType: "Residential",
      status: "Other",
      workDescription:
        "To construct a Residential Use development in the form of Cluster Housing (Semi-detached and Row House Dwellings) and Accessory building (Garage).",
      issueDate: "2026-07-02",
    } as const;

    expect(assessInfillPermitEvent(event).role).toBe(INFILL_EVENT_ROLE.principalResidential);
    expect(classifyInfillProject({ events: [event] }).category).toBe(
      INFILL_PROJECT_CATEGORY.probableRowHousing,
    );
  });

  it("requires both development and building records to describe new residential construction", () => {
    const result = classifyInfillProject({
      events: [
        {
          sourceDataset: "development",
          permitType: "Residential",
          workDescription: "To construct a new single detached dwelling.",
          issueDate: "2026-01-10",
        },
        {
          sourceDataset: "building",
          permitType: "Building Permit",
          permitSubtype: "(02) Addition",
          workDescription: "To construct an addition to an existing Single Detached House.",
          issueDate: "2026-02-10",
        },
      ],
    });

    expect(result.scoreExplanation.map(({ rule }) => rule)).not.toContain(
      "developmentAndBuildingPermit",
    );
  });

  it("uses an inclusive 548-day latest-milestone lookback and splits a 549-day gap", () => {
    const day = 24 * 60 * 60 * 1_000;
    const start = new Date("2024-01-01T00:00:00.000Z");
    const demolition = {
      permitType: "Demolition Permit",
      workDescription: "Demolish the existing house.",
      eventDate: start,
    };
    const construction = (gapDays: number) => ({
      permitType: "Building Permit",
      workDescription: "Construct a new single detached dwelling.",
      buildingType: "Single Detached House",
      eventDate: new Date(start.getTime() + gapDays * day),
    });

    expect(
      classifyInfillProject({ events: [demolition, construction(548)] }).episode.events,
    ).toHaveLength(2);
    expect(
      classifyInfillProject({ events: [demolition, construction(549)] }).episode.events,
    ).toHaveLength(1);
    const boundedChain = classifyInfillProject({
      events: [demolition, construction(548), construction(1_096)],
    });
    expect(boundedChain.episode.events).toHaveLength(2);
    expect(boundedChain.episode.infillStartDate).toEqual(construction(548).eventDate);
    expect(boundedChain.scoreExplanation.map(({ rule }) => rule)).not.toContain(
      "demolitionAtSameAddress",
    );
  });

  it("does not award demolition points when construction is outside its configured window", () => {
    const day = 24 * 60 * 60 * 1_000;
    const start = new Date("2024-01-01T00:00:00.000Z");
    const config = createInfillScoringConfig({ maxEpisodeGapDays: 800 });
    const result = classifyInfillProject(
      {
        events: [
          {
            permitType: "Demolition Permit",
            workDescription: "Demolish existing house.",
            eventDate: start,
          },
          {
            permitType: "Building Permit",
            workDescription: "Construct a new single detached dwelling.",
            buildingType: "Single Detached House",
            eventDate: new Date(start.getTime() + 731 * day),
          },
        ],
      },
      config,
    );

    expect(result.episode.events).toHaveLength(2);
    expect(result.timeline.withinConfiguredWindow).toBe(false);
    expect(result.scoreExplanation.map(({ rule }) => rule)).not.toContain(
      "demolitionAtSameAddress",
    );
  });

  it("does not combine stale development and building permits across episodes", () => {
    const result = classifyInfillProject({
      events: [
        {
          sourceDataset: "development",
          permitType: "Residential",
          workDescription: "Construct a new detached dwelling.",
          issueDate: "2020-01-01",
        },
        {
          sourceDataset: "building",
          permitType: "Building Permit",
          workDescription: "Construct a new detached dwelling.",
          buildingType: "Single Detached House",
          issueDate: "2026-01-01",
        },
      ],
    });

    expect(result.episode.events).toHaveLength(1);
    expect(result.scoreExplanation.map(({ rule }) => rule)).not.toContain(
      "developmentAndBuildingPermit",
    );
  });
});
