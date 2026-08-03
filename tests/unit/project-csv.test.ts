import { describe, expect, it } from "vitest";

import { ProjectCategory, ProjectStage, ReviewStatus } from "../../src/generated/prisma/enums";
import {
  assertCsvExportSize,
  csvCell,
  neutralizeSpreadsheetFormula,
  projectsToCsv,
  type ProjectListItem,
} from "../../src/services/project-read-model";

const project: ProjectListItem = {
  id: "synthetic-project",
  title: "Synthetic project",
  address: "99901 127 ST NW",
  latitude: 53.55,
  longitude: -113.55,
  neighbourhood: { id: "westmount", cityId: "PREVIEW-WESTMOUNT", name: "Westmount" },
  category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
  categoryLabel: "Probable new detached infill",
  stage: ProjectStage.BUILDING_PERMIT,
  stageLabel: "Building permit",
  confidence: 90,
  infillStartDate: "2026-07-01",
  latestInfillActivityDate: "2026-08-01",
  units: 1,
  constructionValue: 485000,
  reviewStatus: ReviewStatus.CONFIRMED,
  reviewStatusLabel: "Confirmed",
  latestEvent: {
    date: "2026-08-01",
    permitType: "Building Permit",
    permitSubtype: "New construction",
    status: "Issued",
  },
};

describe("project CSV export", () => {
  it("uses RFC 4180 quoting and CRLF line endings", () => {
    expect(csvCell('value, with "quotes"\nand newline')).toBe(
      '"value, with ""quotes""\nand newline"',
    );
    const csv = projectsToCsv([{ ...project, address: '99901 "A", 127 ST NW' }]);
    expect(csv).toContain('"99901 ""A"", 127 ST NW"');
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("neutralizes spreadsheet formulas even when whitespace precedes them", () => {
    expect(neutralizeSpreadsheetFormula('=HYPERLINK("https://evil.test")')).toBe(
      '\'=HYPERLINK("https://evil.test")',
    );
    expect(neutralizeSpreadsheetFormula("  +1+1")).toBe("'  +1+1");
    expect(neutralizeSpreadsheetFormula("99901 127 ST NW")).toBe("99901 127 ST NW");
  });

  it("exports only normalized project fields and a same-origin path", () => {
    const csv = projectsToCsv([project]);
    expect(csv).toContain("Address,Neighbourhood,Category");
    expect(csv).toContain("Infill start");
    expect(csv).toContain("Latest infill milestone");
    expect(csv).not.toContain("Earliest permit date");
    expect(csv).toContain("/projects/synthetic-project");
    expect(csv).not.toContain("rawSourcePayload");
  });

  it("rejects oversized or invalid export counts instead of truncating silently", () => {
    expect(() => assertCsvExportSize(25_000)).not.toThrow();
    expect(() => assertCsvExportSize(25_001)).toThrow(/Narrow the filters/);
    expect(() => assertCsvExportSize(-1)).toThrow(/non-negative/);
  });
});
