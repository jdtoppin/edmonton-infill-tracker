import { describe, expect, it } from "vitest";

import {
  jobDate,
  parsePermitImportJobMetadata,
  permitImportConflictKey,
  projectMatchingConflictKey,
  projectReclassificationConflictKey,
} from "../../src/jobs/permit-import-job";

describe("permit import job metadata", () => {
  it("accepts scheduled imports for both official datasets", () => {
    expect(
      parsePermitImportJobMetadata({
        mode: "incremental",
        datasets: ["development", "building"],
        source: "scheduler",
      }),
    ).toMatchObject({ mode: "incremental", datasets: ["development", "building"] });
  });

  it("requires a valid ordered date range for a backfill", () => {
    expect(() =>
      parsePermitImportJobMetadata({
        mode: "backfill",
        datasets: ["building"],
        from: "2026-02-30",
        to: "2026-03-01",
        source: "cli",
      }),
    ).toThrow();
    expect(() =>
      parsePermitImportJobMetadata({
        mode: "backfill",
        datasets: ["building"],
        from: "2026-04-01",
        to: "2026-03-01",
        source: "cli",
      }),
    ).toThrow();
  });

  it("converts a valid civil date without local-timezone drift", () => {
    expect(jobDate("2026-07-30")?.toISOString()).toBe("2026-07-30T00:00:00.000Z");
    expect(jobDate(null)).toBeNull();
  });

  it("serializes import, matching, and reclassification behind one pipeline key", () => {
    expect(projectMatchingConflictKey).toBe(permitImportConflictKey);
    expect(projectReclassificationConflictKey).toBe(permitImportConflictKey);
    expect(permitImportConflictKey).toBe("job:permit-project-pipeline");
  });
});
