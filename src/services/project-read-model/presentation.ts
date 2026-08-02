import { z } from "zod";

import {
  ProjectCategory,
  ProjectStage,
  ReviewStatus,
  RunStatus,
} from "../../generated/prisma/enums";

export const PROJECT_CATEGORY_LABELS = {
  [ProjectCategory.PROBABLE_NEW_DETACHED_INFILL]: "Probable new detached infill",
  [ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE]:
    "Probable new detached infill for resale",
  [ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL]: "Probable semi-detached infill",
  [ProjectCategory.PROBABLE_DUPLEX]: "Probable duplex",
  [ProjectCategory.PROBABLE_ROW_HOUSING]: "Probable row housing",
  [ProjectCategory.PROBABLE_GARDEN_SUITE]: "Probable garden suite",
  [ProjectCategory.DEMOLITION_ONLY]: "Demolition only",
  [ProjectCategory.RENOVATION_OR_ADDITION]: "Renovation or addition",
  [ProjectCategory.UNCERTAIN_RESIDENTIAL_DEVELOPMENT]: "Uncertain residential development",
  [ProjectCategory.NOT_RELEVANT]: "Not relevant",
} as const satisfies Record<ProjectCategory, string>;

export const PROJECT_STAGE_LABELS = {
  [ProjectStage.DISCOVERED]: "Discovered",
  [ProjectStage.DEMOLITION]: "Demolition",
  [ProjectStage.DEVELOPMENT_APPLICATION]: "Development application",
  [ProjectStage.DEVELOPMENT_PERMIT]: "Development permit",
  [ProjectStage.BUILDING_PERMIT]: "Building permit",
  [ProjectStage.CONSTRUCTION]: "Construction",
  [ProjectStage.INSPECTION]: "Inspection",
  [ProjectStage.COMPLETE]: "Occupancy reported",
  [ProjectStage.CANCELLED]: "Cancelled",
} as const satisfies Record<ProjectStage, string>;

export const REVIEW_STATUS_LABELS = {
  [ReviewStatus.PENDING]: "Pending review",
  [ReviewStatus.CONFIRMED]: "Confirmed",
  [ReviewStatus.CORRECTED]: "Corrected",
  [ReviewStatus.NOT_RELEVANT]: "Not relevant",
  [ReviewStatus.MERGED]: "Merged",
} as const satisfies Record<ReviewStatus, string>;

export const RUN_STATUS_LABELS = {
  [RunStatus.PENDING]: "Pending",
  [RunStatus.RUNNING]: "Running",
  [RunStatus.SUCCEEDED]: "Succeeded",
  [RunStatus.PARTIALLY_SUCCEEDED]: "Completed with warnings",
  [RunStatus.FAILED]: "Failed",
} as const satisfies Record<RunStatus, string>;

export type ProjectCategoryTone = "teal" | "copper" | "green" | "neutral";

export function projectCategoryTone(category: ProjectCategory): ProjectCategoryTone {
  switch (category) {
    case ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL:
    case ProjectCategory.PROBABLE_DUPLEX:
    case ProjectCategory.PROBABLE_ROW_HOUSING:
      return "copper";
    case ProjectCategory.PROBABLE_GARDEN_SUITE:
      return "green";
    case ProjectCategory.DEMOLITION_ONLY:
    case ProjectCategory.RENOVATION_OR_ADDITION:
    case ProjectCategory.UNCERTAIN_RESIDENTIAL_DEVELOPMENT:
    case ProjectCategory.NOT_RELEVANT:
      return "neutral";
    default:
      return "teal";
  }
}

export function serializeDecimal(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  let numeric: number;
  if (typeof value === "number") numeric = value;
  else if (typeof value === "string") numeric = Number(value);
  else if (
    typeof value === "object" &&
    "toNumber" in value &&
    typeof value.toNumber === "function"
  ) {
    numeric = value.toNumber();
  } else {
    numeric = Number(String(value));
  }
  return Number.isFinite(numeric) ? numeric : null;
}

export function serializeDate(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function serializeTimestamp(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatConstructionValue(value: number | null): string {
  if (value === null) return "Not reported";
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(value);
}

const confidenceExplanationSchema = z
  .object({
    summary: z.string().trim().min(1).max(5_000),
    score: z.number().int().min(0).max(100).optional(),
    factors: z
      .array(
        z
          .object({
            rule: z.string().trim().min(1).max(200),
            points: z.number().finite().min(-100).max(100),
            message: z.string().trim().min(1).max(1_000).optional(),
          })
          .passthrough(),
      )
      .max(100)
      .default([]),
    timeline: z
      .object({
        demolitionToConstructionDays: z.number().int().nullable().optional(),
        withinConfiguredWindow: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export type ConfidenceExplanation = {
  summary: string;
  score: number;
  factors: Array<{ rule: string; points: number; message: string | null }>;
  timeline: {
    demolitionToConstructionDays: number | null;
    withinConfiguredWindow: boolean | null;
  } | null;
  available: boolean;
};

export function parseConfidenceExplanation(
  value: unknown,
  storedScore: number,
): ConfidenceExplanation {
  const parsed = confidenceExplanationSchema.safeParse(value);
  if (!parsed.success) {
    return {
      summary: "A detailed evidence explanation is not available for this project.",
      score: storedScore,
      factors: [],
      timeline: null,
      available: false,
    };
  }

  return {
    summary: parsed.data.summary,
    score: parsed.data.score ?? storedScore,
    factors: parsed.data.factors.map((factor) => ({
      rule: factor.rule,
      points: factor.points,
      message: factor.message ?? null,
    })),
    timeline: parsed.data.timeline
      ? {
          demolitionToConstructionDays: parsed.data.timeline.demolitionToConstructionDays ?? null,
          withinConfiguredWindow: parsed.data.timeline.withinConfiguredWindow ?? null,
        }
      : null,
    available: true,
  };
}

const citySources = {
  "2ccn-pwtu": {
    name: "City of Edmonton Development Permits",
    identityField: "city_file_number",
    datasetUrl: "https://data.edmonton.ca/Urban-Planning-Economy/Development-Permits/2ccn-pwtu",
  },
  "24uj-dj8v": {
    name: "City of Edmonton General Building Permits",
    identityField: "row_id",
    datasetUrl:
      "https://data.edmonton.ca/Urban-Planning-Economy/General-Building-Permits/24uj-dj8v",
  },
} as const;

export type PermitSourceLink = {
  label: string;
  datasetUrl: string | null;
  recordUrl: string | null;
};

export function permitSourceLink(
  sourceProvider: string,
  sourceRecordIdentifier: string,
): PermitSourceLink {
  const datasetId = Object.keys(citySources).find((candidate) =>
    sourceProvider.endsWith(`:${candidate}`),
  ) as keyof typeof citySources | undefined;
  if (!datasetId) {
    return { label: "Permit source", datasetUrl: null, recordUrl: null };
  }

  const source = citySources[datasetId];
  const recordUrl = new URL(`https://data.edmonton.ca/resource/${datasetId}.json`);
  recordUrl.searchParams.set(source.identityField, sourceRecordIdentifier);
  return {
    label: source.name,
    datasetUrl: source.datasetUrl,
    recordUrl: recordUrl.toString(),
  };
}
