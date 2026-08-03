import { describe, expect, it } from "vitest";

import {
  buildProjectMilestones,
  determineProjectStage,
  PROJECT_STAGE,
} from "../../src/domain/project-timeline";

describe("project timeline milestones and stage precedence", () => {
  it("uses the persisted project event date when a source record has no dated milestone", () => {
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
        type: "DEVELOPMENT_PERMIT",
        date: eventDate,
      }),
    ]);
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
