import { z } from "zod";

import { ProjectCategory, ProjectStage, ReviewStatus } from "../../generated/prisma/enums";

export const PUBLIC_PROJECT_CATEGORIES = [
  ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
  ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
  ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
  ProjectCategory.PROBABLE_DUPLEX,
  ProjectCategory.PROBABLE_ROW_HOUSING,
  ProjectCategory.PROBABLE_GARDEN_SUITE,
  ProjectCategory.DEMOLITION_ONLY,
  ProjectCategory.RENOVATION_OR_ADDITION,
  ProjectCategory.UNCERTAIN_RESIDENTIAL_DEVELOPMENT,
] as const;

/** Categories that represent a new infill episode or its demolition precursor. */
export const POTENTIAL_INFILL_START_CATEGORIES = [
  ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
  ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
  ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
  ProjectCategory.PROBABLE_DUPLEX,
  ProjectCategory.PROBABLE_ROW_HOUSING,
  ProjectCategory.PROBABLE_GARDEN_SUITE,
  ProjectCategory.DEMOLITION_ONLY,
  ProjectCategory.UNCERTAIN_RESIDENTIAL_DEVELOPMENT,
] as const;

export const PROJECT_SORT_FIELDS = [
  "latestEventDate",
  "earliestEventDate",
  "confidence",
  "value",
  "units",
  "address",
  "neighbourhood",
  "category",
  "stage",
  "reviewStatus",
] as const;

export const PROJECT_VIEWS = ["list", "map", "split"] as const;

export type ProjectSortField = (typeof PROJECT_SORT_FIELDS)[number];
export type ProjectView = (typeof PROJECT_VIEWS)[number];
export type ProjectSearchParamValue = string | readonly string[] | undefined;
export type ProjectSearchParams =
  URLSearchParams | Readonly<Record<string, ProjectSearchParamValue>>;

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function isCivilDate(value: string): boolean {
  if (!datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const optionalCivilDate = z
  .string()
  .trim()
  .refine(isCivilDate, "Use a real calendar date in YYYY-MM-DD format.")
  .optional();

const finiteNumber = (minimum: number, maximum: number) =>
  z.coerce.number().finite().min(minimum).max(maximum).optional();

const integer = (minimum: number, maximum: number) =>
  z.coerce.number().int().min(minimum).max(maximum).optional();

const publicCategorySchema = z.enum(PUBLIC_PROJECT_CATEGORIES);

const projectFiltersSchema = z
  .object({
    view: z.enum(PROJECT_VIEWS).default("split"),
    q: z.string().trim().max(200).optional(),
    neighbourhoods: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
    categories: z.array(publicCategorySchema).max(PUBLIC_PROJECT_CATEGORIES.length).default([]),
    stages: z.array(z.enum(ProjectStage)).max(Object.keys(ProjectStage).length).default([]),
    reviewStatuses: z
      .array(z.enum([ReviewStatus.PENDING, ReviewStatus.CONFIRMED, ReviewStatus.CORRECTED]))
      .max(3)
      .default([]),
    from: optionalCivilDate,
    to: optionalCivilDate,
    minConfidence: integer(0, 100),
    minValue: finiteNumber(0, 999_999_999_999.99),
    maxValue: finiteNumber(0, 999_999_999_999.99),
    minUnits: integer(-100_000, 100_000),
    maxUnits: integer(-100_000, 100_000),
    sort: z.enum(PROJECT_SORT_FIELDS).default("latestEventDate"),
    direction: z.enum(["asc", "desc"]).default("desc"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .superRefine((value, context) => {
    if (value.from && value.to && value.from > value.to) {
      context.addIssue({
        code: "custom",
        path: ["to"],
        message: "The end date must be on or after the start date.",
      });
    }
    if (
      value.minValue !== undefined &&
      value.maxValue !== undefined &&
      value.minValue > value.maxValue
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxValue"],
        message: "The maximum value must be at least the minimum value.",
      });
    }
    if (
      value.minUnits !== undefined &&
      value.maxUnits !== undefined &&
      value.minUnits > value.maxUnits
    ) {
      context.addIssue({
        code: "custom",
        path: ["maxUnits"],
        message: "The maximum units must be at least the minimum units.",
      });
    }
  })
  .transform((value) => ({
    ...value,
    q: value.q || undefined,
    neighbourhoods: [...new Set(value.neighbourhoods)],
    categories: [...new Set(value.categories)],
    stages: [...new Set(value.stages)],
    reviewStatuses: [...new Set(value.reviewStatuses)],
  }));

export type ProjectFilters = z.output<typeof projectFiltersSchema>;

function valuesFor(input: ProjectSearchParams, name: string): string[] {
  const values =
    input instanceof URLSearchParams
      ? input.getAll(name)
      : (() => {
          const value = input[name];
          if (value === undefined) return [];
          return typeof value === "string" ? [value] : [...value];
        })();

  return values
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function firstValue(input: ProjectSearchParams, name: string): string | undefined {
  return valuesFor(input, name)[0];
}

function rawProjectFilters(input: ProjectSearchParams) {
  return {
    view: firstValue(input, "view"),
    q: firstValue(input, "q"),
    neighbourhoods: valuesFor(input, "neighbourhood"),
    categories: valuesFor(input, "category"),
    stages: valuesFor(input, "stage"),
    reviewStatuses: valuesFor(input, "reviewStatus"),
    from: firstValue(input, "from"),
    to: firstValue(input, "to"),
    minConfidence: firstValue(input, "minConfidence"),
    minValue: firstValue(input, "minValue"),
    maxValue: firstValue(input, "maxValue"),
    minUnits: firstValue(input, "minUnits"),
    maxUnits: firstValue(input, "maxUnits"),
    sort: firstValue(input, "sort"),
    direction: firstValue(input, "direction"),
    page: firstValue(input, "page"),
    pageSize: firstValue(input, "pageSize"),
  };
}

export function parseProjectFilters(input: ProjectSearchParams): ProjectFilters {
  return projectFiltersSchema.parse(rawProjectFilters(input));
}

export function safeParseProjectFilters(input: ProjectSearchParams) {
  return projectFiltersSchema.safeParse(rawProjectFilters(input));
}

export function defaultProjectFilters(): ProjectFilters {
  return parseProjectFilters(new URLSearchParams());
}

export function projectFiltersToSearchParams(filters: ProjectFilters): URLSearchParams {
  const result = new URLSearchParams();
  if (filters.view !== "split") result.set("view", filters.view);
  if (filters.q) result.set("q", filters.q);
  for (const value of filters.neighbourhoods) result.append("neighbourhood", value);
  for (const value of filters.categories) result.append("category", value);
  for (const value of filters.stages) result.append("stage", value);
  for (const value of filters.reviewStatuses) result.append("reviewStatus", value);
  if (filters.from) result.set("from", filters.from);
  if (filters.to) result.set("to", filters.to);
  if (filters.minConfidence !== undefined)
    result.set("minConfidence", String(filters.minConfidence));
  if (filters.minValue !== undefined) result.set("minValue", String(filters.minValue));
  if (filters.maxValue !== undefined) result.set("maxValue", String(filters.maxValue));
  if (filters.minUnits !== undefined) result.set("minUnits", String(filters.minUnits));
  if (filters.maxUnits !== undefined) result.set("maxUnits", String(filters.maxUnits));
  if (filters.sort !== "latestEventDate") result.set("sort", filters.sort);
  if (filters.direction !== "desc") result.set("direction", filters.direction);
  if (filters.page !== 1) result.set("page", String(filters.page));
  if (filters.pageSize !== 25) result.set("pageSize", String(filters.pageSize));
  return result;
}

export function civilDateStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}
