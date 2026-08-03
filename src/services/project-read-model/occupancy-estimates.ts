import type { Prisma, PrismaClient } from "../../generated/prisma/client";
import { InfillAreaClassification, ProjectCategory } from "../../generated/prisma/enums";
import { assessInfillPermitEvent, INFILL_EVENT_ROLE } from "../../domain/infill-classification";
import {
  baselineOccupancyBenchmark,
  calculateOccupancyBenchmark,
  edmontonCivilDate,
  occupancyBenchmarkCohortStart,
  type OccupancyBenchmark,
  type OccupancyDurationObservation,
} from "../../domain/occupancy-estimate";

const benchmarkCacheMilliseconds = 6 * 60 * 60 * 1_000;
const candidatePageSize = 1_000;

const occupancyCategories = [
  ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
  ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
  ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
  ProjectCategory.PROBABLE_DUPLEX,
  ProjectCategory.PROBABLE_ROW_HOUSING,
  ProjectCategory.PROBABLE_GARDEN_SUITE,
] as const;

type OccupancyCategory = (typeof occupancyCategories)[number];
type OccupancyCategoryGroup = "DETACHED" | OccupancyCategory;

const occupancyCandidateSelect = {
  id: true,
  sourceDataset: true,
  permitType: true,
  permitSubtype: true,
  status: true,
  workDescription: true,
  buildingType: true,
  unitsAdded: true,
  applicationDate: true,
  issueDate: true,
  occupancyGrantedDate: true,
  projectEvent: {
    select: {
      project: { select: { category: true } },
    },
  },
} satisfies Prisma.PermitEventSelect;

type OccupancyCandidate = Prisma.PermitEventGetPayload<{
  select: typeof occupancyCandidateSelect;
}>;

type OccupancyBenchmarkSet = {
  portfolio: OccupancyBenchmark | null;
  categories: Map<OccupancyCategoryGroup, OccupancyBenchmark>;
};

type BenchmarkCacheEntry = {
  asOfDate: string;
  expiresAt: number;
  promise: Promise<OccupancyBenchmarkSet>;
};

const benchmarkCache = new WeakMap<PrismaClient, BenchmarkCacheEntry>();

function categoryGroup(category: OccupancyCategory): OccupancyCategoryGroup {
  return category === ProjectCategory.PROBABLE_NEW_DETACHED_INFILL ||
    category === ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE
    ? "DETACHED"
    : category;
}

function isOccupancyCategory(category: ProjectCategory): category is OccupancyCategory {
  return occupancyCategories.some((candidate) => candidate === category);
}

function isAdequate(benchmark: OccupancyBenchmark | null): benchmark is OccupancyBenchmark {
  return benchmark?.statisticallyAdequate === true;
}

async function loadCandidates(db: PrismaClient, asOfDate: Date): Promise<OccupancyCandidate[]> {
  const candidates: OccupancyCandidate[] = [];
  let cursor: string | undefined;

  while (true) {
    const page = await db.permitEvent.findMany({
      where: {
        sourceDataset: "building",
        issueDate: {
          gte: occupancyBenchmarkCohortStart(asOfDate),
          lte: asOfDate,
        },
        projectEvent: {
          project: {
            mergedIntoId: null,
            infillAreaClassification: InfillAreaClassification.CORE,
            category: { in: [...occupancyCategories] },
          },
        },
      },
      select: occupancyCandidateSelect,
      orderBy: { id: "asc" },
      take: candidatePageSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    candidates.push(...page);
    if (page.length < candidatePageSize) break;
    cursor = page.at(-1)!.id;
  }

  return candidates;
}

async function calculateBenchmarkSet(
  db: PrismaClient,
  asOfDate: Date,
): Promise<OccupancyBenchmarkSet> {
  const candidates = await loadCandidates(db, asOfDate);
  const portfolio: OccupancyDurationObservation[] = [];
  const categories = new Map<OccupancyCategoryGroup, OccupancyDurationObservation[]>();

  for (const candidate of candidates) {
    const category = candidate.projectEvent?.project.category;
    if (!category || !isOccupancyCategory(category) || !candidate.issueDate) continue;
    if (assessInfillPermitEvent(candidate).role !== INFILL_EVENT_ROLE.principalResidential) {
      continue;
    }
    const observation: OccupancyDurationObservation = {
      issueDate: candidate.issueDate,
      occupancyGrantedDate: candidate.occupancyGrantedDate,
    };
    portfolio.push(observation);
    const group = categoryGroup(category);
    const grouped = categories.get(group) ?? [];
    grouped.push(observation);
    categories.set(group, grouped);
  }

  const portfolioBenchmark = calculateOccupancyBenchmark(portfolio, asOfDate, "PORTFOLIO");
  const categoryBenchmarks = new Map<OccupancyCategoryGroup, OccupancyBenchmark>();
  for (const [group, observations] of categories) {
    const benchmark = calculateOccupancyBenchmark(observations, asOfDate, "CATEGORY");
    if (benchmark) categoryBenchmarks.set(group, benchmark);
  }
  return { portfolio: portfolioBenchmark, categories: categoryBenchmarks };
}

async function cachedBenchmarkSet(db: PrismaClient, now: Date): Promise<OccupancyBenchmarkSet> {
  const asOfDate = edmontonCivilDate(now);
  const asOfDateKey = asOfDate.toISOString().slice(0, 10);
  const cached = benchmarkCache.get(db);
  if (cached && cached.asOfDate === asOfDateKey && cached.expiresAt > now.getTime()) {
    return cached.promise;
  }
  const promise = calculateBenchmarkSet(db, asOfDate);
  benchmarkCache.set(db, {
    asOfDate: asOfDateKey,
    expiresAt: now.getTime() + benchmarkCacheMilliseconds,
    promise,
  });
  try {
    return await promise;
  } catch (error) {
    benchmarkCache.delete(db);
    throw error;
  }
}

export async function getOccupancyBenchmark(
  db: PrismaClient,
  category: ProjectCategory,
  now = new Date(),
): Promise<OccupancyBenchmark> {
  if (!isOccupancyCategory(category)) return baselineOccupancyBenchmark();
  const benchmarks = await cachedBenchmarkSet(db, now);
  const categoryBenchmark = benchmarks.categories.get(categoryGroup(category)) ?? null;
  if (isAdequate(categoryBenchmark)) return categoryBenchmark;
  if (isAdequate(benchmarks.portfolio)) return benchmarks.portfolio;
  return baselineOccupancyBenchmark();
}

/** Test helper; production callers use the six-hour process cache. */
export function clearOccupancyBenchmarkCache(db: PrismaClient): void {
  benchmarkCache.delete(db);
}
