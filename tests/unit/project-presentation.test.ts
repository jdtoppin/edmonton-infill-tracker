import { describe, expect, it } from "vitest";

import { ProjectCategory, ProjectStage, ReviewStatus } from "../../src/generated/prisma/enums";
import {
  getPreviewDashboardOverview,
  getPreviewProjectDetail,
  getPreviewProjectMarkers,
  getPreviewProjectPage,
  parseConfidenceExplanation,
  parseProjectFilters,
  permitSourceLink,
  PROJECT_CATEGORY_LABELS,
  PROJECT_STAGE_LABELS,
  REVIEW_STATUS_LABELS,
  serializeDate,
  serializeDecimal,
  serializeTimestamp,
} from "../../src/services/project-read-model";

describe("project read-model presentation", () => {
  it("has human labels for every persisted public-facing enum value", () => {
    expect(Object.keys(PROJECT_CATEGORY_LABELS).sort()).toEqual(
      Object.values(ProjectCategory).sort(),
    );
    expect(Object.keys(PROJECT_STAGE_LABELS).sort()).toEqual(Object.values(ProjectStage).sort());
    expect(Object.keys(REVIEW_STATUS_LABELS).sort()).toEqual(Object.values(ReviewStatus).sort());
  });

  it("serializes dates and Prisma-like decimals without leaking class instances", () => {
    expect(serializeDecimal({ toNumber: () => 485000.25 })).toBe(485000.25);
    expect(serializeDecimal("not-a-number")).toBeNull();
    expect(serializeDate(new Date("2026-08-02T22:15:00.000Z"))).toBe("2026-08-02");
    expect(serializeDate("not-a-date")).toBeNull();
    expect(serializeTimestamp("2026-08-02T22:15:00.000Z")).toBe("2026-08-02T22:15:00.000Z");
  });

  it("normalizes valid confidence evidence and safely falls back for malformed JSON", () => {
    expect(
      parseConfidenceExplanation(
        {
          summary: "Multiple residential permit signals align.",
          score: 85,
          factors: [{ rule: "new_dwelling", points: 30, message: "New dwelling language" }],
          timeline: { demolitionToConstructionDays: 42, withinConfiguredWindow: true },
        },
        80,
      ),
    ).toEqual({
      summary: "Multiple residential permit signals align.",
      score: 85,
      factors: [{ rule: "new_dwelling", points: 30, message: "New dwelling language" }],
      timeline: { demolitionToConstructionDays: 42, withinConfiguredWindow: true },
      available: true,
    });

    const fallback = parseConfidenceExplanation({ summary: "", factors: "unsafe" }, 37);
    expect(fallback.available).toBe(false);
    expect(fallback.score).toBe(37);
    expect(fallback.factors).toEqual([]);
  });

  it("creates only fixed-host source links and treats identifiers as query values", () => {
    const source = permitSourceLink(
      "edmonton-open-data:2ccn-pwtu",
      "A'&redirect=https://evil.test",
    );
    expect(source.datasetUrl).toBe(
      "https://data.edmonton.ca/Urban-Planning-Economy/Development-Permits/2ccn-pwtu",
    );
    const recordUrl = new URL(source.recordUrl!);
    expect(recordUrl.origin).toBe("https://data.edmonton.ca");
    expect(recordUrl.searchParams.get("city_file_number")).toBe("A'&redirect=https://evil.test");
    expect(permitSourceLink("unknown", "record")).toEqual({
      label: "Permit source",
      datasetUrl: null,
      recordUrl: null,
    });
  });

  it("labels all no-database hosted-preview records explicitly", () => {
    const now = new Date("2026-08-02T20:00:00.000Z");
    const filters = parseProjectFilters({
      category: ProjectCategory.PROBABLE_GARDEN_SUITE,
    });
    const page = getPreviewProjectPage(filters, now);
    const markers = getPreviewProjectMarkers(filters, now);
    const detail = getPreviewProjectDetail("preview-ritchie-suite", now);
    const dashboard = getPreviewDashboardOverview(now);

    expect(page.dataMode).toBe("preview");
    expect(page.items.map(({ id }) => id)).toEqual(["preview-ritchie-suite"]);
    expect(markers.markers).toHaveLength(1);
    expect(detail?.dataMode).toBe("preview");
    expect(detail?.timeline[0]?.source.recordUrl).toBeNull();
    expect(
      dashboard.neighbourhoodBreakdown.every(
        (area) => area.latitude !== null && area.longitude !== null,
      ),
    ).toBe(true);
    expect(dashboard.warnings).toContainEqual(
      expect.objectContaining({ code: "PREVIEW_DATA", severity: "info" }),
    );
    expect(getPreviewProjectDetail("", now)).toBeNull();
  });
});
