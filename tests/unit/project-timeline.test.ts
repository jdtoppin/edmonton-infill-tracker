import { describe, expect, it } from "vitest";

import {
  buildProjectMilestones,
  determineProjectStage,
  projectEventDate,
  PROJECT_STAGE,
} from "../../src/domain/project-timeline";

describe("project timeline milestones and stage precedence", () => {
  it("labels a persisted fallback date as observed rather than a civic permit milestone", () => {
    const eventDate = new Date("2026-07-14T00:00:00.000Z");
    const milestones = buildProjectMilestones([
      {
        id: "dateless-development-permit",
        sourceDataset: "development",
        permitType: "Development Permit",
        eventDate,
      },
    ]);

    expect(milestones).toEqual([
      expect.objectContaining({
        permitEventId: "dateless-development-permit",
        type: "OBSERVED",
        stage: PROJECT_STAGE.discovered,
        date: eventDate,
      }),
    ]);
    expect(
      determineProjectStage([
        {
          id: "dateless-development-permit",
          sourceDataset: "development",
          permitType: "Development Permit",
          eventDate,
        },
      ]),
    ).toBe(PROJECT_STAGE.discovered);
  });

  it("uses importedAt only as an observation timestamp for an undated source row", () => {
    const importedAt = new Date("2026-08-02T13:30:04.486Z");

    expect(
      buildProjectMilestones([
        {
          id: "undated-accessory-building",
          sourceDataset: "development",
          permitType: "Accessory Building Combo Permit",
          status: "Other",
          workDescription: "To construct an Accessory Building (mutual Garage).",
          importedAt,
        },
      ]),
    ).toEqual([
      {
        permitEventId: "undated-accessory-building",
        type: "OBSERVED",
        stage: PROJECT_STAGE.discovered,
        date: new Date("2026-08-02T00:00:00.000Z"),
      },
    ]);
  });

  it("keeps the stable creation time when a dateless row is imported again", () => {
    const createdAt = new Date("2026-08-02T13:30:04.486Z");
    const importedAt = new Date("2026-08-10T12:00:00.000Z");
    const event = {
      id: "reimported-undated-row",
      sourceDataset: "development",
      permitType: "Accessory Building Combo Permit",
      createdAt,
      importedAt,
    };

    expect(projectEventDate(event)).toEqual(new Date("2026-08-02T00:00:00.000Z"));
    expect(buildProjectMilestones([event])[0]?.date).toEqual(new Date("2026-08-02T00:00:00.000Z"));
  });

  it("uses tracker creation time when a former civic date remains only on the project link", () => {
    const createdAt = new Date("2026-08-02T13:30:04.486Z");
    const formerIssueDate = new Date("2026-07-20T00:00:00.000Z");
    const event = {
      id: "civic-date-removed",
      sourceDataset: "development",
      permitType: "Accessory Building Combo Permit",
      createdAt,
      eventDate: formerIssueDate,
    };

    expect(projectEventDate(event)).toEqual(new Date("2026-08-02T00:00:00.000Z"));
    expect(buildProjectMilestones([event])).toEqual([
      expect.objectContaining({
        type: "OBSERVED",
        date: new Date("2026-08-02T00:00:00.000Z"),
      }),
    ]);
  });

  it("normalizes a late-evening observation to an idempotent Edmonton civil date", () => {
    const event = {
      id: "late-evening-observation",
      createdAt: new Date("2026-08-03T05:30:00.000Z"),
      eventDate: new Date("2026-08-02T00:00:00.000Z"),
    };

    expect(projectEventDate(event)).toEqual(event.eventDate);
    expect(buildProjectMilestones([event])[0]?.date).toEqual(event.eventDate);
  });

  it("omits a source row that has neither a civic date nor an observation timestamp", () => {
    expect(
      buildProjectMilestones([
        {
          id: "fully-undated-development-row",
          sourceDataset: "development",
          permitType: "Development Permit",
        },
      ]),
    ).toEqual([]);
  });

  it("orders applications, permits, and occupancy chronologically", () => {
    const events = [
      {
        id: "building",
        permitType: "Building Permit",
        applicationDate: new Date("2026-02-01T00:00:00.000Z"),
        issueDate: new Date("2026-03-01T00:00:00.000Z"),
        occupancyGrantedDate: new Date("2026-08-01T00:00:00.000Z"),
      },
      {
        id: "demolition",
        permitType: "Demolition Permit",
        issueDate: new Date("2026-01-15T00:00:00.000Z"),
      },
    ];

    expect(
      buildProjectMilestones(events).map(({ permitEventId, type, date }) => [
        permitEventId,
        type,
        date.toISOString().slice(0, 10),
      ]),
    ).toEqual([
      ["demolition", "DEMOLITION", "2026-01-15"],
      ["building", "APPLICATION", "2026-02-01"],
      ["building", "BUILDING_PERMIT", "2026-03-01"],
      ["building", "OCCUPANCY", "2026-08-01"],
    ]);
  });

  it("uses dataset provenance for Edmonton permit labels that omit the permit family", () => {
    const events = [
      {
        id: "development-source",
        sourceDataset: "development" as const,
        permitType: "Residential",
        permitSubtype: "New",
        issueDate: new Date("2026-02-15T00:00:00.000Z"),
      },
      {
        id: "building-source",
        sourceDataset: "building" as const,
        permitType: "Single, Semi-detached & Rowhousing",
        permitSubtype: "New",
        issueDate: new Date("2026-03-01T00:00:00.000Z"),
      },
    ];
    const milestones = buildProjectMilestones(events);

    expect(
      milestones.map(({ permitEventId, type, stage }) => [permitEventId, type, stage]),
    ).toEqual([
      ["development-source", "DEVELOPMENT_PERMIT", PROJECT_STAGE.developmentPermit],
      ["building-source", "BUILDING_PERMIT", PROJECT_STAGE.buildingPermit],
    ]);
    expect(determineProjectStage([events[1]!])).toBe(PROJECT_STAGE.buildingPermit);
  });

  it("gives occupancy COMPLETE precedence over cancelled permit text", () => {
    expect(
      determineProjectStage([
        {
          id: "occupied",
          permitType: "Building Permit",
          status: "Cancelled",
          issueDate: new Date("2026-01-01T00:00:00.000Z"),
          occupancyGrantedDate: new Date("2026-08-01T00:00:00.000Z"),
        },
      ]),
    ).toBe(PROJECT_STAGE.complete);
  });

  it("uses CANCELLED only when every event is cancelled and occupancy is absent", () => {
    expect(
      determineProjectStage([
        {
          id: "cancelled-development",
          permitType: "Development Permit",
          status: "Withdrawn",
          issueDate: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "cancelled-building",
          permitType: "Building Permit",
          status: "Void",
          issueDate: new Date("2026-02-01T00:00:00.000Z"),
        },
      ]),
    ).toBe(PROJECT_STAGE.cancelled);

    expect(
      determineProjectStage([
        {
          id: "cancelled-development",
          permitType: "Development Permit",
          status: "Withdrawn",
          issueDate: new Date("2026-01-01T00:00:00.000Z"),
        },
        {
          id: "active-building",
          permitType: "Building Permit",
          status: "Issued",
          issueDate: new Date("2026-02-01T00:00:00.000Z"),
        },
      ]),
    ).toBe(PROJECT_STAGE.buildingPermit);
  });

  it("does not label a building-permit application as a development application", () => {
    expect(
      determineProjectStage([
        {
          id: "building-application",
          permitType: "Building Permit",
          status: "Application received",
          applicationDate: new Date("2026-02-01T00:00:00.000Z"),
        },
      ]),
    ).toBe(PROJECT_STAGE.discovered);
    expect(
      determineProjectStage([
        {
          id: "development-application",
          permitType: "Development Permit",
          status: "Application received",
          applicationDate: new Date("2026-02-01T00:00:00.000Z"),
        },
      ]),
    ).toBe(PROJECT_STAGE.developmentApplication);
  });
});
