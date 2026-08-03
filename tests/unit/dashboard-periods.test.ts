import { describe, expect, it } from "vitest";

import { dashboardRange, parseDashboardPeriod } from "../../src/services/project-read-model";

describe("dashboard reporting periods", () => {
  it("parses every supported URL value and falls back safely", () => {
    expect(["7", "30", "90", "180", "365", "730", "all"].map(parseDashboardPeriod)).toEqual([
      7,
      30,
      90,
      180,
      365,
      730,
      "all",
    ]);
    expect(parseDashboardPeriod(undefined)).toBe(7);
    expect(parseDashboardPeriod("not-a-period")).toBe(7);
    expect(parseDashboardPeriod(["180", "7"])).toBe(180);
  });

  it("builds inclusive Edmonton civil-date windows", () => {
    const now = new Date("2026-08-02T19:00:00.000Z");
    const expected = [
      [7, "2026-07-27"],
      [30, "2026-07-04"],
      [90, "2026-05-05"],
      [180, "2026-02-04"],
      [365, "2025-08-03"],
      [730, "2024-08-03"],
    ] as const;

    for (const [period, from] of expected) {
      expect(dashboardRange(period, now)).toMatchObject({
        period,
        from,
        through: "2026-08-02",
      });
    }
    expect(dashboardRange("all", now)).toMatchObject({
      period: "all",
      from: null,
      through: "2026-08-02",
    });
  });

  it("uses the Edmonton date when UTC has already crossed midnight", () => {
    expect(dashboardRange(7, new Date("2026-08-03T03:30:00.000Z"))).toMatchObject({
      from: "2026-07-27",
      through: "2026-08-02",
    });
  });
});
