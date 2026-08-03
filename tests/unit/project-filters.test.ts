import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { ProjectCategory, ProjectStage } from "../../src/generated/prisma/enums";
import {
  buildPublicProjectWhere,
  defaultProjectFilters,
  listProjects,
  parseProjectFilters,
  projectFiltersToSearchParams,
  safeParseProjectFilters,
} from "../../src/services/project-read-model";

describe("project URL filters", () => {
  it("provides bounded, deterministic defaults", () => {
    expect(defaultProjectFilters()).toEqual({
      view: "split",
      q: undefined,
      neighbourhoods: [],
      categories: [],
      stages: [],
      reviewStatuses: [],
      from: undefined,
      to: undefined,
      minConfidence: undefined,
      minValue: undefined,
      maxValue: undefined,
      minUnits: undefined,
      maxUnits: undefined,
      sort: "latestEventDate",
      direction: "desc",
      page: 1,
      pageSize: 25,
    });
  });

  it("accepts repeated and comma-separated filters and removes duplicates", () => {
    const params = new URLSearchParams([
      ["view", "map"],
      ["q", "  99901 127 ST  "],
      ["neighbourhood", "WESTMOUNT,BONNIE-DOON"],
      ["neighbourhood", "WESTMOUNT"],
      ["category", ProjectCategory.PROBABLE_DUPLEX],
      ["category", ProjectCategory.PROBABLE_GARDEN_SUITE],
      ["stage", ProjectStage.BUILDING_PERMIT],
      ["minConfidence", "65"],
      ["minValue", "250000.50"],
      ["maxValue", "750000"],
      ["minUnits", "1"],
      ["maxUnits", "4"],
      ["from", "2026-01-01"],
      ["to", "2026-08-02"],
      ["sort", "value"],
      ["direction", "asc"],
      ["page", "2"],
      ["pageSize", "50"],
    ]);

    const parsed = parseProjectFilters(params);
    expect(parsed).toMatchObject({
      view: "map",
      q: "99901 127 ST",
      neighbourhoods: ["WESTMOUNT", "BONNIE-DOON"],
      categories: [ProjectCategory.PROBABLE_DUPLEX, ProjectCategory.PROBABLE_GARDEN_SUITE],
      stages: [ProjectStage.BUILDING_PERMIT],
      minConfidence: 65,
      minValue: 250000.5,
      maxValue: 750000,
      minUnits: 1,
      maxUnits: 4,
      sort: "value",
      direction: "asc",
      page: 2,
      pageSize: 50,
    });
    expect(parseProjectFilters(projectFiltersToSearchParams(parsed))).toEqual(parsed);
  });

  it("rejects excluded categories, arbitrary sorts, invalid dates, and excessive pages", () => {
    expect(safeParseProjectFilters({ category: ProjectCategory.NOT_RELEVANT }).success).toBe(false);
    expect(safeParseProjectFilters({ sort: "DROP TABLE Project" }).success).toBe(false);
    expect(safeParseProjectFilters({ from: "2026-02-30" }).success).toBe(false);
    expect(safeParseProjectFilters({ pageSize: "101" }).success).toBe(false);
  });

  it("rejects reversed ranges", () => {
    expect(safeParseProjectFilters({ from: "2026-08-02", to: "2026-08-01" }).success).toBe(false);
    expect(safeParseProjectFilters({ minValue: "2", maxValue: "1" }).success).toBe(false);
    expect(safeParseProjectFilters({ minUnits: "2", maxUnits: "1" }).success).toBe(false);
  });

  it("filters date ranges by the latest qualifying infill milestone", () => {
    const where = buildPublicProjectWhere(
      parseProjectFilters({ from: "2026-01-01", to: "2026-08-02" }),
    );

    expect(where).toMatchObject({
      latestInfillActivityDate: {
        gte: new Date("2026-01-01T00:00:00.000Z"),
        lte: new Date("2026-08-02T00:00:00.000Z"),
      },
    });
    expect(where).not.toHaveProperty("latestEventDate");
  });

  it("sorts the default project view by the latest qualifying infill milestone", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = {
      project: {
        count: vi.fn().mockResolvedValue(0),
        findMany,
      },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    } as unknown as PrismaClient;

    await listProjects(db, defaultProjectFilters());

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ latestInfillActivityDate: { sort: "desc", nulls: "last" } }, { id: "asc" }],
      }),
    );
  });
});
