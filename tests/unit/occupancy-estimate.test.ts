import { describe, expect, it } from "vitest";
import {
  baselineOccupancyBenchmark,
  buildOccupancyTimingEstimate,
  calculateOccupancyBenchmark,
  edmontonCivilDate,
  occupancyBenchmarkCohortStart,
  OCCUPANCY_BASELINE_DAYS,
  OCCUPANCY_MAX_COMPARISON_DAYS,
  type OccupancyDurationObservation,
} from "../../src/domain/occupancy-estimate";

const asOf = new Date("2026-08-03T18:00:00.000Z");
const day = (daysBeforeAsOf: number) => new Date(Date.UTC(2026, 7, 3 - daysBeforeAsOf));

function completed(durationDays: number, issueDaysAgo = 700): OccupancyDurationObservation {
  const issueDate = day(issueDaysAgo);
  return {
    issueDate,
    occupancyGrantedDate: new Date(issueDate.getTime() + durationDays * 86_400_000),
  };
}

describe("occupancy timing estimates", () => {
  it("converts an instant to Edmonton's civil date", () => {
    expect(edmontonCivilDate(new Date("2026-08-03T05:30:00.000Z")).toISOString()).toBe(
      "2026-08-02T00:00:00.000Z",
    );
    expect(edmontonCivilDate(new Date("2026-08-03T06:30:00.000Z")).toISOString()).toBe(
      "2026-08-03T00:00:00.000Z",
    );
  });

  it("does not let the rolling cohort predate published residential occupancy coverage", () => {
    expect(occupancyBenchmarkCohortStart(asOf).toISOString()).toBe("2022-01-01T00:00:00.000Z");
    expect(occupancyBenchmarkCohortStart(new Date("2029-08-03T18:00:00.000Z")).toISOString()).toBe(
      "2024-08-03T00:00:00.000Z",
    );
  });

  it("computes Kaplan-Meier completion quantiles with open permits right-censored", () => {
    const observations: OccupancyDurationObservation[] = [
      completed(100),
      completed(200),
      completed(300),
      completed(400),
      { issueDate: day(250), occupancyGrantedDate: null },
    ];

    const benchmark = calculateOccupancyBenchmark(observations, asOf, "PORTFOLIO");

    expect(benchmark).toMatchObject({
      cohortSize: 5,
      observedOccupancies: 4,
      censoredPermits: 1,
      p25Days: 200,
      medianDays: 300,
      p75Days: 400,
      statisticallyAdequate: false,
    });
  });

  it("excludes same-day, pre-issue, future issue, and future occupancy records", () => {
    const benchmark = calculateOccupancyBenchmark(
      [
        completed(0),
        completed(-1),
        { issueDate: day(-1), occupancyGrantedDate: null },
        { issueDate: day(100), occupancyGrantedDate: day(-1) },
        { issueDate: day(100), occupancyGrantedDate: new Date(Number.NaN) },
        completed(100),
        completed(200),
      ],
      asOf,
      "CATEGORY",
    );

    expect(benchmark).toMatchObject({
      cohortSize: 2,
      observedOccupancies: 2,
      medianDays: 100,
    });
  });

  it("marks a benchmark adequate only at both minimum count boundaries", () => {
    const thirtyOccupancies = Array.from({ length: 30 }, () => completed(100));
    const twentyOpen = Array.from({ length: 20 }, () => ({
      issueDate: day(200),
      occupancyGrantedDate: null,
    }));

    expect(
      calculateOccupancyBenchmark([...thirtyOccupancies, ...twentyOpen], asOf, "PORTFOLIO"),
    ).toMatchObject({
      cohortSize: 50,
      occupancyCount: 30,
      statisticallyAdequate: true,
    });
    expect(
      calculateOccupancyBenchmark(
        [
          ...thirtyOccupancies.slice(1),
          ...twentyOpen,
          { issueDate: day(200), occupancyGrantedDate: null },
        ],
        asOf,
        "PORTFOLIO",
      ),
    ).toMatchObject({ statisticallyAdequate: false });
  });

  it("counts day 730 as occupancy but censors day 731 at the comparison cap", () => {
    const benchmark = calculateOccupancyBenchmark(
      [completed(730, 730), completed(731, 731)],
      asOf,
      "PORTFOLIO",
    );

    expect(benchmark).toMatchObject({
      cohortSize: 2,
      observedOccupancies: 1,
      censoredPermits: 1,
      medianDays: 730,
    });
  });

  it("returns null when right-censoring prevents the median from being estimated", () => {
    expect(
      calculateOccupancyBenchmark(
        [
          completed(100),
          { issueDate: day(150), occupancyGrantedDate: null },
          { issueDate: day(150), occupancyGrantedDate: null },
        ],
        asOf,
        "CATEGORY",
      ),
    ).toBeNull();
  });

  it("uses independent 548-day baseline rather than deriving it from the cap", () => {
    expect(OCCUPANCY_BASELINE_DAYS).toBe(548);
    expect(OCCUPANCY_MAX_COMPARISON_DAYS).toBe(730);
    expect(baselineOccupancyBenchmark()).toMatchObject({
      scope: "BASELINE",
      medianDays: 548,
      maxComparisonDays: 730,
    });
  });

  it("keeps actual elapsed time while marking active permits beyond two years", () => {
    const estimate = buildOccupancyTimingEstimate(day(800), baselineOccupancyBenchmark(), asOf);

    expect(estimate).toMatchObject({
      elapsedDays: 800,
      comparisonElapsedDays: 730,
      typicalDays: 548,
      daysFromTypical: 252,
      comparisonProgress: 1,
      beyondComparisonWindow: true,
    });
  });

  it("does not build a timing estimate for a future building permit", () => {
    expect(buildOccupancyTimingEstimate(day(-1), baselineOccupancyBenchmark(), asOf)).toBeNull();
  });
});
