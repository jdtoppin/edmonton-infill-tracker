import type { ProjectListItem } from "./project-queries";

const spreadsheetFormulaPrefix = /^[\t\r\n ]*[=+\-@]/;

export function neutralizeSpreadsheetFormula(value: string): string {
  return spreadsheetFormulaPrefix.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number | null | undefined): string {
  const text = neutralizeSpreadsheetFormula(
    value === null || value === undefined ? "" : String(value),
  );
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

const columns = [
  ["Address", (project: ProjectListItem) => project.address],
  ["Neighbourhood", (project: ProjectListItem) => project.neighbourhood.name],
  ["Category", (project: ProjectListItem) => project.categoryLabel],
  ["Stage", (project: ProjectListItem) => project.stageLabel],
  ["Confidence score", (project: ProjectListItem) => project.confidence],
  ["Earliest permit date", (project: ProjectListItem) => project.firstDetectedDate],
  ["Latest event date", (project: ProjectListItem) => project.latestEventDate],
  ["Estimated units", (project: ProjectListItem) => project.units],
  ["Construction value (CAD)", (project: ProjectListItem) => project.constructionValue],
  ["Review status", (project: ProjectListItem) => project.reviewStatusLabel],
  ["Latest permit type", (project: ProjectListItem) => project.latestEvent?.permitType],
  ["Latest permit subtype", (project: ProjectListItem) => project.latestEvent?.permitSubtype],
  ["Latest permit status", (project: ProjectListItem) => project.latestEvent?.status],
  ["Project URL", (project: ProjectListItem) => `/projects/${encodeURIComponent(project.id)}`],
] as const;

export function projectsToCsv(projects: readonly ProjectListItem[]): string {
  const lines = [
    columns.map(([heading]) => csvCell(heading)).join(","),
    ...projects.map((project) => columns.map(([, value]) => csvCell(value(project))).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

export const PROJECT_CSV_MAX_ROWS = 25_000;

export function assertCsvExportSize(total: number, maximum = PROJECT_CSV_MAX_ROWS): void {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError("CSV export row count must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new RangeError("CSV export maximum must be a positive safe integer.");
  }
  if (total > maximum) {
    throw new RangeError(
      `This export contains ${total.toLocaleString("en-CA")} rows. Narrow the filters to ${maximum.toLocaleString("en-CA")} rows or fewer.`,
    );
  }
}
