const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

/** Two years is the longest interval treated as a comparable occupancy outcome. */
export const OCCUPANCY_MAX_COMPARISON_DAYS = 730;

/** Independent fallback used when the local data cannot support an empirical median. */
export const OCCUPANCY_BASELINE_DAYS = 548;

export const OCCUPANCY_MIN_COHORT_SIZE = 50;
export const OCCUPANCY_MIN_OCCUPANCIES = 30;
export const OCCUPANCY_RESIDENTIAL_COVERAGE_START = "2022-01-01";

export type OccupancyBenchmarkScope = "CATEGORY" | "PORTFOLIO" | "BASELINE";

/**
 * One City building-permit row. Issue and occupancy must come from this same
 * row; callers must not combine milestones from different permits.
 */
export type OccupancyDurationObservation = {
  issueDate: Date | null;
  occupancyGrantedDate: Date | null;
};

export type OccupancyBenchmark = {
  scope: OccupancyBenchmarkScope;
  cohortSize: number;
  occupancyCount: number;
  observedOccupancies: number;
  censoredPermits: number;
  p25Days: number | null;
  medianDays: number;
  p75Days: number | null;
  statisticallyAdequate: boolean;
  maxComparisonDays: number;
};

export type OccupancyTimingEstimate = {
  issueDate: string;
  asOfDate: string;
  elapsedDays: number;
  comparisonElapsedDays: number;
  typicalDays: number;
  p25Days: number | null;
  medianDays: number;
  p75Days: number | null;
  estimatedDate: string;
  typicalOccupancyDate: string;
  daysRemaining: number;
  daysBeyondTypical: number;
  daysFromTypical: number;
  comparisonProgress: number;
  beyondComparisonWindow: boolean;
  maxComparisonDays: number;
  basis: "HISTORICAL_KAPLAN_MEIER" | "PLANNING_BASELINE";
  scope: OccupancyBenchmarkScope;
  cohortSize: number;
  occupancyCount: number;
  benchmark: OccupancyBenchmark;
};

type SurvivalObservation = {
  days: number;
  occupied: boolean;
};

function validDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function edmontonCivilDateValue(now: Date): Date {
  if (!validDate(now)) throw new RangeError("A valid as-of date is required.");

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return new Date(Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day)));
}

/** Converts an instant to Edmonton's civil day, represented as UTC midnight. */
export function edmontonCivilDate(now: Date): Date {
  return edmontonCivilDateValue(now);
}

/** Uses at most five years without predating the City's residential coverage. */
export function occupancyBenchmarkCohortStart(asOfDate: Date): Date {
  const start = edmontonCivilDateValue(asOfDate);
  start.setUTCFullYear(start.getUTCFullYear() - 5);
  const coverageStart = new Date(`${OCCUPANCY_RESIDENTIAL_COVERAGE_START}T00:00:00.000Z`);
  return start < coverageStart ? coverageStart : start;
}

/** Normalizes a database DATE to a timezone-independent civil-day value. */
function utcCivilDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function civilDaysBetween(start: Date, end: Date): number {
  return Math.round((end.getTime() - start.getTime()) / DAY_MILLISECONDS);
}

function addCivilDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MILLISECONDS);
}

function parseAsOfDate(value: Date | string): Date {
  if (value instanceof Date) return edmontonCivilDateValue(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new RangeError("The as-of date must use YYYY-MM-DD format.");
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!validDate(parsed) || parsed.toISOString().slice(0, 10) !== value) {
    throw new RangeError("The as-of date must be a valid civil date.");
  }
  return parsed;
}

function survivalObservation(
  observation: OccupancyDurationObservation,
  asOfDate: Date,
): SurvivalObservation | null {
  if (!validDate(observation.issueDate)) return null;

  const issueDate = utcCivilDate(observation.issueDate);
  const elapsedDays = civilDaysBetween(issueDate, asOfDate);
  if (elapsedDays < 0) return null;

  if (observation.occupancyGrantedDate === null) {
    return {
      days: Math.min(elapsedDays, OCCUPANCY_MAX_COMPARISON_DAYS),
      occupied: false,
    };
  }
  if (!validDate(observation.occupancyGrantedDate)) return null;

  const occupancyDate = utcCivilDate(observation.occupancyGrantedDate);
  if (occupancyDate > asOfDate) return null;
  const durationDays = civilDaysBetween(issueDate, occupancyDate);
  if (durationDays <= 0) return null;
  if (durationDays > OCCUPANCY_MAX_COMPARISON_DAYS) {
    return { days: OCCUPANCY_MAX_COMPARISON_DAYS, occupied: false };
  }
  return { days: durationDays, occupied: true };
}

/**
 * Calculates completion-time quantiles using a Kaplan-Meier product-limit
 * estimate. Open permits and outcomes beyond the comparison window remain in
 * the risk set as right-censored observations rather than being mistaken for
 * quick completions or discarded.
 *
 * Returns null when the cohort does not reach its median within two years.
 */
export function calculateOccupancyBenchmark(
  observations: readonly OccupancyDurationObservation[],
  asOfDate: Date | string,
  scope: Exclude<OccupancyBenchmarkScope, "BASELINE">,
): OccupancyBenchmark | null {
  const civilAsOfDate = parseAsOfDate(asOfDate);
  const survival = observations
    .map((observation) => survivalObservation(observation, civilAsOfDate))
    .filter((observation): observation is SurvivalObservation => observation !== null);
  if (survival.length === 0) return null;

  const byDay = new Map<number, { occupied: number; censored: number }>();
  for (const observation of survival) {
    const bucket = byDay.get(observation.days) ?? { occupied: 0, censored: 0 };
    if (observation.occupied) bucket.occupied += 1;
    else bucket.censored += 1;
    byDay.set(observation.days, bucket);
  }

  let atRisk = survival.length;
  let survivalProbability = 1;
  let p25Days: number | null = null;
  let medianDays: number | null = null;
  let p75Days: number | null = null;

  for (const [days, outcomes] of [...byDay.entries()].sort(([left], [right]) => left - right)) {
    if (outcomes.occupied > 0 && atRisk > 0) {
      survivalProbability *= 1 - outcomes.occupied / atRisk;
      if (p25Days === null && survivalProbability <= 0.75) p25Days = days;
      if (medianDays === null && survivalProbability <= 0.5) medianDays = days;
      if (p75Days === null && survivalProbability <= 0.25) p75Days = days;
    }
    atRisk -= outcomes.occupied + outcomes.censored;
  }

  if (medianDays === null) return null;
  const observedOccupancies = survival.filter(({ occupied }) => occupied).length;
  const cohortSize = survival.length;
  return {
    scope,
    cohortSize,
    occupancyCount: observedOccupancies,
    observedOccupancies,
    censoredPermits: cohortSize - observedOccupancies,
    p25Days,
    medianDays,
    p75Days,
    statisticallyAdequate:
      cohortSize >= OCCUPANCY_MIN_COHORT_SIZE && observedOccupancies >= OCCUPANCY_MIN_OCCUPANCIES,
    maxComparisonDays: OCCUPANCY_MAX_COMPARISON_DAYS,
  };
}

export function baselineOccupancyBenchmark(): OccupancyBenchmark {
  return {
    scope: "BASELINE",
    cohortSize: 0,
    occupancyCount: 0,
    observedOccupancies: 0,
    censoredPermits: 0,
    p25Days: null,
    medianDays: OCCUPANCY_BASELINE_DAYS,
    p75Days: null,
    statisticallyAdequate: false,
    maxComparisonDays: OCCUPANCY_MAX_COMPARISON_DAYS,
  };
}

/** Builds the property-level marker for an issued permit whose occupancy is not recorded. */
export function buildOccupancyTimingEstimate(
  issueDate: Date,
  benchmark: OccupancyBenchmark,
  now: Date,
): OccupancyTimingEstimate | null {
  if (!validDate(issueDate)) return null;
  const civilIssueDate = utcCivilDate(issueDate);
  const asOfDate = edmontonCivilDateValue(now);
  const elapsedDays = civilDaysBetween(civilIssueDate, asOfDate);
  if (elapsedDays < 0) return null;

  const comparisonElapsedDays = Math.min(elapsedDays, OCCUPANCY_MAX_COMPARISON_DAYS);
  const typicalOccupancyDate = addCivilDays(civilIssueDate, benchmark.medianDays)
    .toISOString()
    .slice(0, 10);
  return {
    issueDate: civilIssueDate.toISOString().slice(0, 10),
    asOfDate: asOfDate.toISOString().slice(0, 10),
    elapsedDays,
    comparisonElapsedDays,
    typicalDays: benchmark.medianDays,
    p25Days: benchmark.p25Days,
    medianDays: benchmark.medianDays,
    p75Days: benchmark.p75Days,
    estimatedDate: typicalOccupancyDate,
    typicalOccupancyDate,
    daysRemaining: Math.max(0, benchmark.medianDays - elapsedDays),
    daysBeyondTypical: Math.max(0, elapsedDays - benchmark.medianDays),
    daysFromTypical: elapsedDays - benchmark.medianDays,
    comparisonProgress: comparisonElapsedDays / OCCUPANCY_MAX_COMPARISON_DAYS,
    beyondComparisonWindow: elapsedDays > OCCUPANCY_MAX_COMPARISON_DAYS,
    maxComparisonDays: OCCUPANCY_MAX_COMPARISON_DAYS,
    basis: benchmark.scope === "BASELINE" ? "PLANNING_BASELINE" : "HISTORICAL_KAPLAN_MEIER",
    scope: benchmark.scope,
    cohortSize: benchmark.cohortSize,
    occupancyCount: benchmark.occupancyCount,
    benchmark,
  };
}
