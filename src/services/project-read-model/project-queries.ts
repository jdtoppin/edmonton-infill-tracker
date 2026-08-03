import { z } from "zod";

import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import {
  ProjectCategory,
  ProjectStage,
  ReviewStatus,
  RunStatus,
  UserRole,
} from "../../generated/prisma/enums";
import { buildProjectMilestones } from "../../domain/project-timeline";
import {
  civilDateStart,
  defaultProjectFilters,
  PUBLIC_PROJECT_CATEGORIES,
  type ProjectFilters,
} from "./filters";
import {
  parseConfidenceExplanation,
  permitSourceLink,
  PROJECT_CATEGORY_LABELS,
  PROJECT_STAGE_LABELS,
  REVIEW_STATUS_LABELS,
  RUN_STATUS_LABELS,
  serializeDate,
  serializeDecimal,
  serializeTimestamp,
} from "./presentation";

const dayMilliseconds = 24 * 60 * 60 * 1_000;
const identifierSchema = z.string().trim().min(1).max(200);

const projectListSelect = {
  id: true,
  title: true,
  category: true,
  currentStage: true,
  earliestEventDate: true,
  latestEventDate: true,
  estimatedUnits: true,
  estimatedConstructionValue: true,
  infillConfidence: true,
  reviewStatus: true,
  address: {
    select: {
      normalizedStreetAddress: true,
      latitude: true,
      longitude: true,
    },
  },
  neighbourhood: {
    select: {
      id: true,
      cityNeighbourhoodId: true,
      name: true,
    },
  },
  events: {
    take: 1,
    orderBy: [{ eventDate: "desc" as const }, { permitEventId: "desc" as const }],
    select: {
      eventDate: true,
      permitEvent: {
        select: {
          permitType: true,
          permitSubtype: true,
          status: true,
        },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

type ProjectListRecord = Prisma.ProjectGetPayload<{ select: typeof projectListSelect }>;

const projectActivitySelect = {
  eventDate: true,
  permitEvent: {
    select: {
      permitType: true,
      permitSubtype: true,
      status: true,
    },
  },
  project: { select: projectListSelect },
} satisfies Prisma.ProjectEventSelect;

const projectDetailSelect = {
  id: true,
  title: true,
  category: true,
  currentStage: true,
  earliestEventDate: true,
  latestEventDate: true,
  estimatedUnits: true,
  estimatedConstructionValue: true,
  marketListingStatus: true,
  marketLastCheckedAt: true,
  marketReviewRequired: true,
  infillConfidence: true,
  confidenceExplanation: true,
  reviewStatus: true,
  reviewedAt: true,
  createdAt: true,
  updatedAt: true,
  address: {
    select: {
      normalizedStreetAddress: true,
      latitude: true,
      longitude: true,
    },
  },
  neighbourhood: {
    select: {
      id: true,
      cityNeighbourhoodId: true,
      name: true,
    },
  },
  events: {
    orderBy: [{ eventDate: "asc" as const }, { permitEventId: "asc" as const }],
    select: {
      eventDate: true,
      permitEvent: {
        select: {
          id: true,
          sourceProvider: true,
          sourceDataset: true,
          sourceRecordIdentifier: true,
          permitNumber: true,
          permitType: true,
          permitSubtype: true,
          applicationDate: true,
          issueDate: true,
          occupancyGrantedDate: true,
          status: true,
          workDescription: true,
          buildingType: true,
          constructionValue: true,
          unitsAdded: true,
        },
      },
    },
  },
} satisfies Prisma.ProjectSelect;

type ProjectDetailRecord = Prisma.ProjectGetPayload<{ select: typeof projectDetailSelect }>;

export type ReadModelDataMode = "live" | "preview";

export type ProjectListItem = {
  id: string;
  title: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  neighbourhood: {
    id: string;
    cityId: string;
    name: string;
  };
  category: ProjectCategory;
  categoryLabel: string;
  stage: ProjectStage;
  stageLabel: string;
  confidence: number;
  firstDetectedDate: string | null;
  latestEventDate: string | null;
  units: number | null;
  constructionValue: number | null;
  reviewStatus: ReviewStatus;
  reviewStatusLabel: string;
  latestEvent: {
    date: string;
    permitType: string;
    permitSubtype: string | null;
    status: string | null;
  } | null;
};

export type ProjectPage = {
  dataMode: ReadModelDataMode;
  items: ProjectListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type ProjectMarker = Pick<
  ProjectListItem,
  | "id"
  | "title"
  | "address"
  | "latitude"
  | "longitude"
  | "neighbourhood"
  | "category"
  | "categoryLabel"
  | "stage"
  | "stageLabel"
  | "confidence"
  | "latestEventDate"
  | "units"
  | "constructionValue"
  | "latestEvent"
>;

export type ProjectMarkerResult = {
  dataMode: ReadModelDataMode;
  markers: ProjectMarker[];
  truncated: boolean;
  missingCoordinateCount: number;
};

export type ProjectTimelineEntry = {
  key: string;
  milestoneType: ReturnType<typeof buildProjectMilestones>[number]["type"];
  stage: ProjectStage;
  stageLabel: string;
  date: string;
  permitEventId: string;
  permitNumber: string | null;
  permitType: string;
  permitSubtype: string | null;
  status: string | null;
  description: string | null;
  buildingType: string | null;
  units: number | null;
  constructionValue: number | null;
  applicationDate: string | null;
  issueDate: string | null;
  occupancyGrantedDate: string | null;
  source: ReturnType<typeof permitSourceLink>;
};

export type ProjectDetail = {
  dataMode: ReadModelDataMode;
  id: string;
  title: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  neighbourhood: ProjectListItem["neighbourhood"];
  category: ProjectCategory;
  categoryLabel: string;
  stage: ProjectStage;
  stageLabel: string;
  confidence: number;
  confidenceExplanation: ReturnType<typeof parseConfidenceExplanation>;
  firstDetectedDate: string | null;
  latestEventDate: string | null;
  units: number | null;
  constructionValue: number | null;
  reviewStatus: ReviewStatus;
  reviewStatusLabel: string;
  marketListingStatus: string;
  marketLastCheckedAt: string | null;
  marketReviewRequired: boolean;
  createdAt: string;
  updatedAt: string;
  timeline: ProjectTimelineEntry[];
};

export type DashboardPeriod = 7 | 30 | 90;
export type LifecycleCounts = { development: number; building: number; occupancy: number };

export type DashboardOverview = {
  dataMode: ReadModelDataMode;
  generatedAt: string;
  newProjects: Record<DashboardPeriod, number>;
  lifecycle: Record<DashboardPeriod, LifecycleCounts>;
  categoryBreakdown: Array<{ category: ProjectCategory; label: string; count: number }>;
  neighbourhoodBreakdown: Array<{
    id: string;
    cityId: string;
    name: string;
    count: number;
    latitude: number | null;
    longitude: number | null;
  }>;
  highConfidenceProjects: ProjectListItem[];
  recentDemolitions: ProjectListItem[];
  recentConstruction: ProjectListItem[];
  latestImport: {
    status: RunStatus;
    statusLabel: string;
    sourceProvider: string;
    completedAt: string | null;
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  } | null;
  warnings: Array<{
    code:
      | "NO_IMPORT"
      | "IMPORT_FAILED"
      | "IMPORT_WARNINGS"
      | "STALE_IMPORT"
      | "UNMATCHED_PERMITS"
      | "MISSING_COORDINATES"
      | "PREVIEW_DATA";
    severity: "info" | "warning" | "error";
    message: string;
    count: number | null;
  }>;
};

export type ProjectFilterOptions = {
  dataMode: ReadModelDataMode;
  neighbourhoods: Array<{ id: string; cityId: string; name: string; projectCount: number }>;
  categories: Array<{ value: ProjectCategory; label: string; projectCount: number }>;
  stages: Array<{ value: ProjectStage; label: string; projectCount: number }>;
};

export type AdminProjectSummary = {
  dataMode: ReadModelDataMode;
  pendingReview: number;
  corrected: number;
  marketReviewRequired: number;
  merged: number;
  unassignedPermits: number;
  failedRawRecords: number;
  latestImportStatus: RunStatus | null;
  latestJobStatus: RunStatus | null;
};

export class ProjectReadAuthorizationError extends Error {}

const publicBaseWhere: Prisma.ProjectWhereInput = {
  mergedIntoId: null,
  category: { not: ProjectCategory.NOT_RELEVANT },
};

export function buildPublicProjectWhere(filters: ProjectFilters): Prisma.ProjectWhereInput {
  const activityDate =
    filters.from || filters.to
      ? {
          ...(filters.from ? { gte: civilDateStart(filters.from) } : {}),
          ...(filters.to ? { lte: civilDateStart(filters.to) } : {}),
        }
      : undefined;
  const constructionValue =
    filters.minValue !== undefined || filters.maxValue !== undefined
      ? {
          ...(filters.minValue !== undefined ? { gte: filters.minValue } : {}),
          ...(filters.maxValue !== undefined ? { lte: filters.maxValue } : {}),
        }
      : undefined;
  const estimatedUnits =
    filters.minUnits !== undefined || filters.maxUnits !== undefined
      ? {
          ...(filters.minUnits !== undefined ? { gte: filters.minUnits } : {}),
          ...(filters.maxUnits !== undefined ? { lte: filters.maxUnits } : {}),
        }
      : undefined;

  return {
    ...publicBaseWhere,
    ...(filters.neighbourhoods.length
      ? {
          neighbourhood: {
            cityNeighbourhoodId: { in: filters.neighbourhoods },
          },
        }
      : {}),
    ...(filters.categories.length
      ? { category: { in: filters.categories, not: ProjectCategory.NOT_RELEVANT } }
      : {}),
    ...(filters.stages.length ? { currentStage: { in: filters.stages } } : {}),
    ...(filters.reviewStatuses.length ? { reviewStatus: { in: filters.reviewStatuses } } : {}),
    ...(filters.minConfidence !== undefined
      ? { infillConfidence: { gte: filters.minConfidence } }
      : {}),
    ...(activityDate ? { latestEventDate: activityDate } : {}),
    ...(constructionValue ? { estimatedConstructionValue: constructionValue } : {}),
    ...(estimatedUnits ? { estimatedUnits } : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            {
              address: {
                normalizedStreetAddress: { contains: filters.q, mode: "insensitive" },
              },
            },
            {
              events: {
                some: {
                  permitEvent: {
                    permitNumber: { contains: filters.q, mode: "insensitive" },
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
}

function projectOrderBy(filters: ProjectFilters): Prisma.ProjectOrderByWithRelationInput[] {
  const direction = filters.direction;
  const primary: Prisma.ProjectOrderByWithRelationInput = (() => {
    switch (filters.sort) {
      case "earliestEventDate":
        return { earliestEventDate: { sort: direction, nulls: "last" } };
      case "confidence":
        return { infillConfidence: direction };
      case "value":
        return { estimatedConstructionValue: { sort: direction, nulls: "last" } };
      case "units":
        return { estimatedUnits: { sort: direction, nulls: "last" } };
      case "address":
        return { address: { normalizedStreetAddress: direction } };
      case "neighbourhood":
        return { neighbourhood: { name: direction } };
      case "category":
        return { category: direction };
      case "stage":
        return { currentStage: direction };
      case "reviewStatus":
        return { reviewStatus: direction };
      default:
        return { latestEventDate: { sort: direction, nulls: "last" } };
    }
  })();
  return [primary, { id: "asc" }];
}

function serializeProjectListRecord(record: ProjectListRecord): ProjectListItem {
  const latest = record.events[0];
  return {
    id: record.id,
    title: record.title,
    address: record.address.normalizedStreetAddress,
    latitude: serializeDecimal(record.address.latitude),
    longitude: serializeDecimal(record.address.longitude),
    neighbourhood: {
      id: record.neighbourhood.id,
      cityId: record.neighbourhood.cityNeighbourhoodId,
      name: record.neighbourhood.name,
    },
    category: record.category,
    categoryLabel: PROJECT_CATEGORY_LABELS[record.category],
    stage: record.currentStage,
    stageLabel: PROJECT_STAGE_LABELS[record.currentStage],
    confidence: record.infillConfidence,
    firstDetectedDate: serializeDate(record.earliestEventDate),
    latestEventDate: serializeDate(record.latestEventDate),
    units: record.estimatedUnits,
    constructionValue: serializeDecimal(record.estimatedConstructionValue),
    reviewStatus: record.reviewStatus,
    reviewStatusLabel: REVIEW_STATUS_LABELS[record.reviewStatus],
    latestEvent: latest
      ? {
          date: serializeDate(latest.eventDate)!,
          permitType: latest.permitEvent.permitType,
          permitSubtype: latest.permitEvent.permitSubtype,
          status: latest.permitEvent.status,
        }
      : null,
  };
}

export async function listProjects(
  db: PrismaClient,
  filters: ProjectFilters,
): Promise<ProjectPage> {
  const where = buildPublicProjectWhere(filters);
  const [total, records] = await db.$transaction(
    [
      db.project.count({ where }),
      db.project.findMany({
        where,
        select: projectListSelect,
        orderBy: projectOrderBy(filters),
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return {
    dataMode: "live",
    items: records.map(serializeProjectListRecord),
    total,
    page: filters.page,
    pageSize: filters.pageSize,
    totalPages: Math.ceil(total / filters.pageSize),
  };
}

export async function listProjectsForExport(
  db: PrismaClient,
  filters: ProjectFilters,
  maximumRows = 25_000,
): Promise<{ items: ProjectListItem[]; total: number; tooLarge: boolean }> {
  const limit = z.number().int().min(1).max(25_000).parse(maximumRows);
  const where = buildPublicProjectWhere(filters);
  const total = await db.project.count({ where });
  if (total > limit) return { items: [], total, tooLarge: true };
  const records = await db.project.findMany({
    where,
    select: projectListSelect,
    orderBy: projectOrderBy(filters),
    take: limit,
  });
  return { items: records.map(serializeProjectListRecord), total, tooLarge: false };
}

export async function listProjectMarkers(
  db: PrismaClient,
  filters: ProjectFilters,
  limit = 2_000,
): Promise<ProjectMarkerResult> {
  const boundedLimit = z.number().int().min(1).max(10_000).parse(limit);
  const baseWhere = buildPublicProjectWhere(filters);
  const coordinateWhere: Prisma.ProjectWhereInput = {
    AND: [
      baseWhere,
      {
        address: {
          latitude: { not: null },
          longitude: { not: null },
        },
      },
    ],
  };
  const [records, missingCoordinateCount] = await Promise.all([
    db.project.findMany({
      where: coordinateWhere,
      select: projectListSelect,
      orderBy: projectOrderBy(filters),
      take: boundedLimit + 1,
    }),
    db.project.count({
      where: {
        AND: [
          baseWhere,
          {
            OR: [{ address: { latitude: null } }, { address: { longitude: null } }],
          },
        ],
      },
    }),
  ]);
  return {
    dataMode: "live",
    markers: records.slice(0, boundedLimit).map(serializeProjectListRecord),
    truncated: records.length > boundedLimit,
    missingCoordinateCount,
  };
}

function serializeProjectDetail(
  record: ProjectDetailRecord,
  dataMode: ReadModelDataMode,
): ProjectDetail {
  const permits = record.events.map(({ eventDate, permitEvent }) => ({
    ...permitEvent,
    eventDate,
  }));
  const permitsById = new Map(permits.map((permit) => [permit.id, permit]));
  const timeline = buildProjectMilestones(permits).map((milestone): ProjectTimelineEntry => {
    const permit = permitsById.get(milestone.permitEventId)!;
    const date = serializeDate(milestone.date)!;
    return {
      key: `${permit.id}:${milestone.type}:${date}`,
      milestoneType: milestone.type,
      stage: milestone.stage as ProjectStage,
      stageLabel: PROJECT_STAGE_LABELS[milestone.stage as ProjectStage],
      date,
      permitEventId: permit.id,
      permitNumber: permit.permitNumber,
      permitType: permit.permitType,
      permitSubtype: permit.permitSubtype,
      status: permit.status,
      description: permit.workDescription,
      buildingType: permit.buildingType,
      units: permit.unitsAdded,
      constructionValue: serializeDecimal(permit.constructionValue),
      applicationDate: serializeDate(permit.applicationDate),
      issueDate: serializeDate(permit.issueDate),
      occupancyGrantedDate: serializeDate(permit.occupancyGrantedDate),
      source: permitSourceLink(permit.sourceProvider, permit.sourceRecordIdentifier),
    };
  });

  return {
    dataMode,
    id: record.id,
    title: record.title,
    address: record.address.normalizedStreetAddress,
    latitude: serializeDecimal(record.address.latitude),
    longitude: serializeDecimal(record.address.longitude),
    neighbourhood: {
      id: record.neighbourhood.id,
      cityId: record.neighbourhood.cityNeighbourhoodId,
      name: record.neighbourhood.name,
    },
    category: record.category,
    categoryLabel: PROJECT_CATEGORY_LABELS[record.category],
    stage: record.currentStage,
    stageLabel: PROJECT_STAGE_LABELS[record.currentStage],
    confidence: record.infillConfidence,
    confidenceExplanation: parseConfidenceExplanation(
      record.confidenceExplanation,
      record.infillConfidence,
    ),
    firstDetectedDate: serializeDate(record.earliestEventDate),
    latestEventDate: serializeDate(record.latestEventDate),
    units: record.estimatedUnits,
    constructionValue: serializeDecimal(record.estimatedConstructionValue),
    reviewStatus: record.reviewStatus,
    reviewStatusLabel: REVIEW_STATUS_LABELS[record.reviewStatus],
    marketListingStatus: record.marketListingStatus,
    marketLastCheckedAt: serializeTimestamp(record.marketLastCheckedAt),
    marketReviewRequired: record.marketReviewRequired,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    timeline,
  };
}

export async function getProjectDetail(
  db: PrismaClient,
  projectId: string,
): Promise<ProjectDetail | null> {
  const parsedId = identifierSchema.safeParse(projectId);
  if (!parsedId.success) return null;
  const id = parsedId.data;
  const record = await db.project.findFirst({
    where: { id, ...publicBaseWhere },
    select: projectDetailSelect,
  });
  return record ? serializeProjectDetail(record, "live") : null;
}

function ago(now: Date, days: DashboardPeriod): Date {
  return new Date(now.getTime() - days * dayMilliseconds);
}

function edmontonCivilDate(now: Date, daysBefore = 0): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return new Date(
    Date.UTC(Number(value.year), Number(value.month) - 1, Number(value.day) - daysBefore),
  );
}

async function lifecycleCounts(
  db: PrismaClient,
  since: Date,
  through: Date,
): Promise<LifecycleCounts> {
  const linkedToPublicProject = { project: publicBaseWhere };
  const [development, building, occupancy] = await Promise.all([
    db.permitEvent.count({
      where: {
        sourceDataset: "development",
        issueDate: { gte: since, lte: through },
        projectEvent: linkedToPublicProject,
      },
    }),
    db.permitEvent.count({
      where: {
        sourceDataset: "building",
        issueDate: { gte: since, lte: through },
        projectEvent: linkedToPublicProject,
      },
    }),
    db.permitEvent.count({
      where: {
        sourceDataset: "building",
        occupancyGrantedDate: { gte: since, lte: through },
        projectEvent: linkedToPublicProject,
      },
    }),
  ]);
  return { development, building, occupancy };
}

async function recentProjectsForPermitText(
  db: PrismaClient,
  terms: string[],
  limit: number,
  projectWhere: Prisma.ProjectWhereInput = publicBaseWhere,
): Promise<ProjectListItem[]> {
  const records = await db.projectEvent.findMany({
    where: {
      project: projectWhere,
      permitEvent: {
        OR: terms.flatMap((term) => [
          { permitType: { contains: term, mode: "insensitive" as const } },
          { permitSubtype: { contains: term, mode: "insensitive" as const } },
          { workDescription: { contains: term, mode: "insensitive" as const } },
        ]),
      },
    },
    select: projectActivitySelect,
    orderBy: [{ eventDate: "desc" }, { permitEventId: "asc" }],
    take: limit,
  });
  return records.map((record) => ({
    ...serializeProjectListRecord(record.project),
    latestEventDate: serializeDate(record.eventDate),
    latestEvent: {
      date: serializeDate(record.eventDate)!,
      permitType: record.permitEvent.permitType,
      permitSubtype: record.permitEvent.permitSubtype,
      status: record.permitEvent.status,
    },
  }));
}

export async function getDashboardOverview(
  db: PrismaClient,
  now = new Date(),
): Promise<DashboardOverview> {
  const periods = [7, 30, 90] as const;
  const today = edmontonCivilDate(now);
  const [
    newProjectValues,
    lifecycleValues,
    categoryGroups,
    neighbourhoodGroups,
    highConfidenceRecords,
    recentDemolitions,
    recentConstruction,
    latestImport,
    latestSuccessfulImport,
    unassignedPermits,
    missingCoordinates,
  ] = await Promise.all([
    Promise.all(
      periods.map((period) =>
        db.project.count({ where: { ...publicBaseWhere, createdAt: { gte: ago(now, period) } } }),
      ),
    ),
    Promise.all(
      periods.map((period) => lifecycleCounts(db, edmontonCivilDate(now, period - 1), today)),
    ),
    db.project.groupBy({ by: ["category"], where: publicBaseWhere, _count: { _all: true } }),
    db.project.groupBy({ by: ["neighbourhoodId"], where: publicBaseWhere, _count: { _all: true } }),
    db.project.findMany({
      where: { ...publicBaseWhere, infillConfidence: { gte: 80 } },
      select: projectListSelect,
      orderBy: [
        { infillConfidence: "desc" },
        { latestEventDate: { sort: "desc", nulls: "last" } },
        { id: "asc" },
      ],
      take: 5,
    }),
    recentProjectsForPermitText(db, ["demolition", "demolish"], 5),
    recentProjectsForPermitText(db, ["new construction", "new dwelling", "building"], 5, {
      ...publicBaseWhere,
      category: {
        in: [
          ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
          ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
          ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
          ProjectCategory.PROBABLE_DUPLEX,
          ProjectCategory.PROBABLE_ROW_HOUSING,
          ProjectCategory.PROBABLE_GARDEN_SUITE,
        ],
        not: ProjectCategory.NOT_RELEVANT,
      },
    }),
    db.importRun.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        status: true,
        sourceProvider: true,
        completedAt: true,
        recordsCreated: true,
        recordsUpdated: true,
        recordsSkipped: true,
        recordsFailed: true,
      },
    }),
    db.importRun.findFirst({
      where: { status: { in: [RunStatus.SUCCEEDED, RunStatus.PARTIALLY_SUCCEEDED] } },
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      select: { completedAt: true },
    }),
    db.permitEvent.count({ where: { projectEvent: null } }),
    db.project.count({
      where: {
        AND: [
          publicBaseWhere,
          { OR: [{ address: { latitude: null } }, { address: { longitude: null } }] },
        ],
      },
    }),
  ]);

  const neighbourhoodIds = neighbourhoodGroups.map(({ neighbourhoodId }) => neighbourhoodId);
  const [neighbourhoods, neighbourhoodCoordinates] = await Promise.all([
    db.neighbourhood.findMany({
      where: { id: { in: neighbourhoodIds } },
      select: { id: true, cityNeighbourhoodId: true, name: true },
    }),
    db.address.groupBy({
      by: ["neighbourhoodId"],
      where: {
        neighbourhoodId: { in: neighbourhoodIds },
        latitude: { not: null },
        longitude: { not: null },
        projects: { some: publicBaseWhere },
      },
      _avg: { latitude: true, longitude: true },
    }),
  ]);
  const neighbourhoodById = new Map(neighbourhoods.map((item) => [item.id, item]));
  const coordinatesByNeighbourhoodId = new Map(
    neighbourhoodCoordinates.flatMap((item) =>
      item.neighbourhoodId
        ? [
            [
              item.neighbourhoodId,
              {
                latitude: serializeDecimal(item._avg.latitude),
                longitude: serializeDecimal(item._avg.longitude),
              },
            ] as const,
          ]
        : [],
    ),
  );
  const warnings: DashboardOverview["warnings"] = [];

  if (!latestImport) {
    warnings.push({
      code: "NO_IMPORT",
      severity: "info",
      message: "No permit import has completed yet.",
      count: null,
    });
  } else if (latestImport.status === RunStatus.FAILED) {
    warnings.push({
      code: "IMPORT_FAILED",
      severity: "error",
      message: "The latest permit import failed. An administrator can review operations.",
      count: latestImport.recordsFailed,
    });
  } else if (
    latestImport.status === RunStatus.PARTIALLY_SUCCEEDED ||
    latestImport.recordsFailed > 0
  ) {
    warnings.push({
      code: "IMPORT_WARNINGS",
      severity: "warning",
      message: "The latest permit import completed with quarantined records.",
      count: latestImport.recordsFailed,
    });
  }
  if (
    latestSuccessfulImport?.completedAt &&
    latestSuccessfulImport.completedAt.getTime() < now.getTime() - 2 * dayMilliseconds
  ) {
    warnings.push({
      code: "STALE_IMPORT",
      severity: "warning",
      message: "No successful City permit import has completed in the past 48 hours.",
      count: null,
    });
  }
  if (unassignedPermits > 0) {
    warnings.push({
      code: "UNMATCHED_PERMITS",
      severity: "warning",
      message: "Some permit records are still waiting to be grouped into projects.",
      count: unassignedPermits,
    });
  }
  if (missingCoordinates > 0) {
    warnings.push({
      code: "MISSING_COORDINATES",
      severity: "info",
      message: "Some projects can be shown in the list but not on the map.",
      count: missingCoordinates,
    });
  }

  return {
    dataMode: "live",
    generatedAt: now.toISOString(),
    newProjects: { 7: newProjectValues[0], 30: newProjectValues[1], 90: newProjectValues[2] },
    lifecycle: { 7: lifecycleValues[0], 30: lifecycleValues[1], 90: lifecycleValues[2] },
    categoryBreakdown: categoryGroups
      .map((item) => ({
        category: item.category,
        label: PROJECT_CATEGORY_LABELS[item.category],
        count: item._count._all,
      }))
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    neighbourhoodBreakdown: neighbourhoodGroups
      .flatMap((item) => {
        const neighbourhood = neighbourhoodById.get(item.neighbourhoodId);
        return neighbourhood
          ? [
              {
                id: neighbourhood.id,
                cityId: neighbourhood.cityNeighbourhoodId,
                name: neighbourhood.name,
                count: item._count._all,
                latitude: coordinatesByNeighbourhoodId.get(neighbourhood.id)?.latitude ?? null,
                longitude: coordinatesByNeighbourhoodId.get(neighbourhood.id)?.longitude ?? null,
              },
            ]
          : [];
      })
      .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name)),
    highConfidenceProjects: highConfidenceRecords.map(serializeProjectListRecord),
    recentDemolitions,
    recentConstruction,
    latestImport: latestImport
      ? {
          status: latestImport.status,
          statusLabel: RUN_STATUS_LABELS[latestImport.status],
          sourceProvider: latestImport.sourceProvider,
          completedAt: serializeTimestamp(latestImport.completedAt),
          created: latestImport.recordsCreated,
          updated: latestImport.recordsUpdated,
          skipped: latestImport.recordsSkipped,
          failed: latestImport.recordsFailed,
        }
      : null,
    warnings,
  };
}

export async function getProjectFilterOptions(db: PrismaClient): Promise<ProjectFilterOptions> {
  const [neighbourhoodGroups, categoryGroups, stageGroups] = await Promise.all([
    db.project.groupBy({ by: ["neighbourhoodId"], where: publicBaseWhere, _count: { _all: true } }),
    db.project.groupBy({ by: ["category"], where: publicBaseWhere, _count: { _all: true } }),
    db.project.groupBy({ by: ["currentStage"], where: publicBaseWhere, _count: { _all: true } }),
  ]);
  const neighbourhoods = await db.neighbourhood.findMany({
    where: { id: { in: neighbourhoodGroups.map((item) => item.neighbourhoodId) } },
    select: { id: true, cityNeighbourhoodId: true, name: true },
  });
  const countByNeighbourhood = new Map(
    neighbourhoodGroups.map((item) => [item.neighbourhoodId, item._count._all]),
  );
  const countByCategory = new Map(categoryGroups.map((item) => [item.category, item._count._all]));
  const countByStage = new Map(stageGroups.map((item) => [item.currentStage, item._count._all]));

  return {
    dataMode: "live",
    neighbourhoods: neighbourhoods
      .map((item) => ({
        id: item.id,
        cityId: item.cityNeighbourhoodId,
        name: item.name,
        projectCount: countByNeighbourhood.get(item.id) ?? 0,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    categories: PUBLIC_PROJECT_CATEGORIES.map((value) => ({
      value,
      label: PROJECT_CATEGORY_LABELS[value],
      projectCount: countByCategory.get(value) ?? 0,
    })),
    stages: Object.values(ProjectStage).map((value) => ({
      value,
      label: PROJECT_STAGE_LABELS[value],
      projectCount: countByStage.get(value) ?? 0,
    })),
  };
}

async function requireActiveAdmin(db: PrismaClient, actorUserId: string): Promise<void> {
  const id = identifierSchema.parse(actorUserId);
  const actor = await db.user.findUnique({
    where: { id },
    select: { role: true, isActive: true },
  });
  if (!actor || !actor.isActive || actor.role !== UserRole.ADMIN) {
    throw new ProjectReadAuthorizationError("An active administrator is required.");
  }
}

export async function getAdminProjectSummary(
  db: PrismaClient,
  actorUserId: string,
): Promise<AdminProjectSummary> {
  await requireActiveAdmin(db, actorUserId);
  const [
    pendingReview,
    corrected,
    marketReviewRequired,
    merged,
    unassignedPermits,
    failedRawRecords,
    latestImport,
    latestJob,
  ] = await Promise.all([
    db.project.count({ where: { mergedIntoId: null, reviewStatus: ReviewStatus.PENDING } }),
    db.project.count({ where: { mergedIntoId: null, reviewStatus: ReviewStatus.CORRECTED } }),
    db.project.count({ where: { mergedIntoId: null, marketReviewRequired: true } }),
    db.project.count({ where: { mergedIntoId: { not: null } } }),
    db.permitEvent.count({ where: { projectEvent: null } }),
    db.rawPermitRecord.count({ where: { processingStatus: "FAILED" } }),
    db.importRun.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true },
    }),
    db.jobRun.findFirst({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { status: true },
    }),
  ]);
  return {
    dataMode: "live",
    pendingReview,
    corrected,
    marketReviewRequired,
    merged,
    unassignedPermits,
    failedRawRecords,
    latestImportStatus: latestImport?.status ?? null,
    latestJobStatus: latestJob?.status ?? null,
  };
}

type PreviewProject = ProjectListItem & {
  detail: ProjectDetail;
};

function previewDate(now: Date, daysBefore: number): string {
  return new Date(now.getTime() - daysBefore * dayMilliseconds).toISOString().slice(0, 10);
}

function previewProjects(now = new Date()): PreviewProject[] {
  const records = [
    {
      id: "preview-westmount-detached",
      address: "99901 127 ST NW",
      neighbourhood: { id: "preview-westmount", cityId: "PREVIEW-WESTMOUNT", name: "Westmount" },
      latitude: 53.5588,
      longitude: -113.5525,
      category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
      stage: ProjectStage.BUILDING_PERMIT,
      confidence: 90,
      units: 1,
      value: 485_000,
      daysBefore: 2,
      summary:
        "A demolition and new detached dwelling permit appear at the same synthetic address.",
    },
    {
      id: "preview-bonnie-doon-semi",
      address: "99902 88 AVE NW",
      neighbourhood: {
        id: "preview-bonnie-doon",
        cityId: "PREVIEW-BONNIE-DOON",
        name: "Bonnie Doon",
      },
      latitude: 53.5219,
      longitude: -113.46,
      category: ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
      stage: ProjectStage.DEVELOPMENT_PERMIT,
      confidence: 80,
      units: 2,
      value: 760_000,
      daysBefore: 8,
      summary: "A synthetic development permit describes a new semi-detached dwelling.",
    },
    {
      id: "preview-ritchie-suite",
      address: "99903 76 AVE NW",
      neighbourhood: { id: "preview-ritchie", cityId: "PREVIEW-RITCHIE", name: "Ritchie" },
      latitude: 53.5124,
      longitude: -113.4779,
      category: ProjectCategory.PROBABLE_GARDEN_SUITE,
      stage: ProjectStage.BUILDING_PERMIT,
      confidence: 75,
      units: 1,
      value: 215_000,
      daysBefore: 21,
      summary: "A synthetic permit explicitly describes construction of a garden suite.",
    },
  ] as const;

  return records.map((record) => {
    const latestDate = previewDate(now, record.daysBefore);
    const listItem: ProjectListItem = {
      id: record.id,
      title: `${record.address} preview infill activity`,
      address: record.address,
      latitude: record.latitude,
      longitude: record.longitude,
      neighbourhood: record.neighbourhood,
      category: record.category,
      categoryLabel: PROJECT_CATEGORY_LABELS[record.category],
      stage: record.stage,
      stageLabel: PROJECT_STAGE_LABELS[record.stage],
      confidence: record.confidence,
      firstDetectedDate: previewDate(now, record.daysBefore + 14),
      latestEventDate: latestDate,
      units: record.units,
      constructionValue: record.value,
      reviewStatus: ReviewStatus.CONFIRMED,
      reviewStatusLabel: REVIEW_STATUS_LABELS[ReviewStatus.CONFIRMED],
      latestEvent: {
        date: latestDate,
        permitType:
          record.stage === ProjectStage.DEVELOPMENT_PERMIT
            ? "Development Permit"
            : "Building Permit",
        permitSubtype: "Synthetic preview",
        status: "Issued",
      },
    };
    return {
      ...listItem,
      detail: {
        dataMode: "preview",
        ...listItem,
        confidenceExplanation: {
          summary: record.summary,
          score: record.confidence,
          factors: [
            {
              rule: "synthetic_preview_evidence",
              points: record.confidence,
              message: "Synthetic evidence used only for the hosted product preview.",
            },
          ],
          timeline: null,
          available: true,
        },
        marketListingStatus: "NOT_CHECKED",
        marketLastCheckedAt: null,
        marketReviewRequired: false,
        createdAt: `${listItem.firstDetectedDate}T12:00:00.000Z`,
        updatedAt: `${latestDate}T12:00:00.000Z`,
        timeline: [
          {
            key: `${record.id}:preview:${latestDate}`,
            milestoneType:
              record.stage === ProjectStage.DEVELOPMENT_PERMIT
                ? "DEVELOPMENT_PERMIT"
                : "BUILDING_PERMIT",
            stage: record.stage,
            stageLabel: PROJECT_STAGE_LABELS[record.stage],
            date: latestDate,
            permitEventId: `${record.id}-permit`,
            permitNumber: "SYNTHETIC-PREVIEW",
            permitType: listItem.latestEvent!.permitType,
            permitSubtype: "Synthetic preview",
            status: "Issued",
            description: record.summary,
            buildingType: null,
            units: record.units,
            constructionValue: record.value,
            applicationDate: listItem.firstDetectedDate,
            issueDate: latestDate,
            occupancyGrantedDate: null,
            source: { label: "Synthetic preview", datasetUrl: null, recordUrl: null },
          },
        ],
      },
    };
  });
}

function previewMatches(project: ProjectListItem, filters: ProjectFilters): boolean {
  const query = filters.q?.toLocaleLowerCase("en-CA");
  return Boolean(
    (!query ||
      [project.title, project.address, project.neighbourhood.name, project.latestEvent?.permitType]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLocaleLowerCase("en-CA").includes(query))) &&
    (!filters.neighbourhoods.length ||
      filters.neighbourhoods.includes(project.neighbourhood.cityId)) &&
    (!filters.categories.length ||
      filters.categories.some((category) => category === project.category)) &&
    (!filters.stages.length || filters.stages.includes(project.stage)) &&
    (!filters.reviewStatuses.length ||
      filters.reviewStatuses.some((status) => status === project.reviewStatus)) &&
    (filters.minConfidence === undefined || project.confidence >= filters.minConfidence) &&
    (!filters.from || !project.latestEventDate || project.latestEventDate >= filters.from) &&
    (!filters.to || !project.latestEventDate || project.latestEventDate <= filters.to) &&
    (filters.minValue === undefined ||
      (project.constructionValue !== null && project.constructionValue >= filters.minValue)) &&
    (filters.maxValue === undefined ||
      (project.constructionValue !== null && project.constructionValue <= filters.maxValue)) &&
    (filters.minUnits === undefined ||
      (project.units !== null && project.units >= filters.minUnits)) &&
    (filters.maxUnits === undefined ||
      (project.units !== null && project.units <= filters.maxUnits)),
  );
}

function comparePreviewProjects(filters: ProjectFilters) {
  return (left: ProjectListItem, right: ProjectListItem): number => {
    const values: Record<
      ProjectFilters["sort"],
      (item: ProjectListItem) => string | number | null
    > = {
      latestEventDate: (item) => item.latestEventDate,
      earliestEventDate: (item) => item.firstDetectedDate,
      confidence: (item) => item.confidence,
      value: (item) => item.constructionValue,
      units: (item) => item.units,
      address: (item) => item.address,
      neighbourhood: (item) => item.neighbourhood.name,
      category: (item) => item.category,
      stage: (item) => item.stage,
      reviewStatus: (item) => item.reviewStatus,
    };
    const leftValue = values[filters.sort](left);
    const rightValue = values[filters.sort](right);
    if (leftValue === null && rightValue !== null) return 1;
    if (leftValue !== null && rightValue === null) return -1;
    const compared = String(leftValue ?? "").localeCompare(String(rightValue ?? ""), "en-CA", {
      numeric: true,
    });
    return (filters.direction === "asc" ? compared : -compared) || left.id.localeCompare(right.id);
  };
}

export function getPreviewProjectPage(
  filters: ProjectFilters = defaultProjectFilters(),
  now = new Date(),
): ProjectPage {
  const matching = previewProjects(now)
    .filter((project) => previewMatches(project, filters))
    .sort(comparePreviewProjects(filters));
  return {
    dataMode: "preview",
    items: matching.slice((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize),
    total: matching.length,
    page: filters.page,
    pageSize: filters.pageSize,
    totalPages: Math.ceil(matching.length / filters.pageSize),
  };
}

export function getPreviewProjectMarkers(
  filters: ProjectFilters = defaultProjectFilters(),
  now = new Date(),
): ProjectMarkerResult {
  const items = previewProjects(now)
    .filter((project) => previewMatches(project, filters))
    .sort(comparePreviewProjects(filters));
  return { dataMode: "preview", markers: items, truncated: false, missingCoordinateCount: 0 };
}

export function getPreviewProjectDetail(projectId: string, now = new Date()): ProjectDetail | null {
  const parsedId = identifierSchema.safeParse(projectId);
  if (!parsedId.success) return null;
  const id = parsedId.data;
  return previewProjects(now).find((project) => project.id === id)?.detail ?? null;
}

export function getPreviewFilterOptions(now = new Date()): ProjectFilterOptions {
  const items = previewProjects(now);
  const neighbourhoods = new Map<string, ProjectFilterOptions["neighbourhoods"][number]>();
  for (const item of items) {
    const existing = neighbourhoods.get(item.neighbourhood.id);
    neighbourhoods.set(item.neighbourhood.id, {
      id: item.neighbourhood.id,
      cityId: item.neighbourhood.cityId,
      name: item.neighbourhood.name,
      projectCount: (existing?.projectCount ?? 0) + 1,
    });
  }
  return {
    dataMode: "preview",
    neighbourhoods: [...neighbourhoods.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    ),
    categories: PUBLIC_PROJECT_CATEGORIES.map((value) => ({
      value,
      label: PROJECT_CATEGORY_LABELS[value],
      projectCount: items.filter((item) => item.category === value).length,
    })),
    stages: Object.values(ProjectStage).map((value) => ({
      value,
      label: PROJECT_STAGE_LABELS[value],
      projectCount: items.filter((item) => item.stage === value).length,
    })),
  };
}

export function getPreviewDashboardOverview(now = new Date()): DashboardOverview {
  const items = previewProjects(now);
  const countWithin = (days: DashboardPeriod) =>
    items.filter(
      (item) =>
        item.latestEventDate !== null &&
        item.latestEventDate >=
          new Date(now.getTime() - days * dayMilliseconds).toISOString().slice(0, 10),
    ).length;
  const neighbourhoods = getPreviewFilterOptions(now).neighbourhoods;
  return {
    dataMode: "preview",
    generatedAt: now.toISOString(),
    newProjects: { 7: countWithin(7), 30: countWithin(30), 90: countWithin(90) },
    lifecycle: {
      7: { development: 0, building: 1, occupancy: 0 },
      30: { development: 1, building: 2, occupancy: 0 },
      90: { development: 1, building: 2, occupancy: 0 },
    },
    categoryBreakdown: PUBLIC_PROJECT_CATEGORIES.flatMap((category) => {
      const count = items.filter((item) => item.category === category).length;
      return count ? [{ category, label: PROJECT_CATEGORY_LABELS[category], count }] : [];
    }),
    neighbourhoodBreakdown: neighbourhoods.map(({ id, cityId, name, projectCount }) => {
      const projects = items.filter((project) => project.neighbourhood.id === id);
      const located = projects.filter(
        (project): project is PreviewProject & { latitude: number; longitude: number } =>
          project.latitude !== null && project.longitude !== null,
      );
      return {
        id,
        cityId,
        name,
        count: projectCount,
        latitude:
          located.length === 0
            ? null
            : located.reduce((total, project) => total + project.latitude, 0) / located.length,
        longitude:
          located.length === 0
            ? null
            : located.reduce((total, project) => total + project.longitude, 0) / located.length,
      };
    }),
    highConfidenceProjects: items.filter((item) => item.confidence >= 80),
    recentDemolitions: [items[0]],
    recentConstruction: items,
    latestImport: null,
    warnings: [
      {
        code: "PREVIEW_DATA",
        severity: "info",
        message: "This hosted preview uses clearly labelled synthetic project records.",
        count: items.length,
      },
    ],
  };
}

export function getPreviewAdminSummary(): AdminProjectSummary {
  return {
    dataMode: "preview",
    pendingReview: 0,
    corrected: 0,
    marketReviewRequired: 0,
    merged: 0,
    unassignedPermits: 0,
    failedRawRecords: 0,
    latestImportStatus: null,
    latestJobStatus: null,
  };
}
