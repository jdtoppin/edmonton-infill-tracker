import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { ProjectCategory, ProjectStage } from "../../src/generated/prisma/enums";
import {
  buildPublicProjectWhere,
  defaultProjectFilters,
  listProjectMarkers,
  listProjects,
  parseProjectFilters,
  POTENTIAL_INFILL_START_CATEGORIES,
  projectFiltersToSearchParams,
  safeParseProjectFilters,
} from "../../src/services/project-read-model";

describe("project URL filters", () => {
  it("keeps renovation-only work out of potential infill starts", () => {
    expect(POTENTIAL_INFILL_START_CATEGORIES).not.toContain(ProjectCategory.RENOVATION_OR_ADDITION);
    expect(POTENTIAL_INFILL_START_CATEGORIES).toContain(ProjectCategory.DEMOLITION_ONLY);
    expect(POTENTIAL_INFILL_START_CATEGORIES).toContain(
      ProjectCategory.UNCERTAIN_RESIDENTIAL_DEVELOPMENT,
    );
  });

  it("provides bounded, deterministic defaults", () => {
    expect(defaultProjectFilters()).toEqual({
      view: "split",
      scope: "citywide",
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
      ["scope", "core"],
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
      scope: "core",
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
    expect(safeParseProjectFilters({ scope: "private" }).success).toBe(false);
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

  it("limits dashboard drill-downs to the core infill area", () => {
    const where = buildPublicProjectWhere(
      parseProjectFilters({
        scope: "core",
        neighbourhood: "WESTMOUNT",
        category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
        from: "2026-07-27",
        to: "2026-08-02",
      }),
    );

    expect(where).toMatchObject({
      infillAreaClassification: "CORE",
      neighbourhood: { cityNeighbourhoodId: { in: ["WESTMOUNT"] } },
      category: {
        in: [ProjectCategory.PROBABLE_NEW_DETACHED_INFILL],
        not: ProjectCategory.NOT_RELEVANT,
      },
      latestInfillActivityDate: {
        gte: new Date("2026-07-27T00:00:00.000Z"),
        lte: new Date("2026-08-02T00:00:00.000Z"),
      },
    });
  });

  it("uses the same canonical filters for list rows and map markers", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const db = {
      project: { count, findMany },
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
    } as unknown as PrismaClient;
    const filters = parseProjectFilters({
      scope: "core",
      view: "split",
      neighbourhood: "WESTMOUNT",
      from: "2026-07-27",
      to: "2026-08-02",
    });
    const canonicalWhere = buildPublicProjectWhere(filters);

    await listProjects(db, filters);
    expect(findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: canonicalWhere }));

    findMany.mockClear();
    await listProjectMarkers(db, filters);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            canonicalWhere,
            {
              address: {
                latitude: { not: null },
                longitude: { not: null },
              },
            },
          ],
        },
      }),
    );
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
