import { describe, expect, it } from "vitest";

import {
  createAlertDeduplicationKey,
  isDuplicateAlert,
} from "../../src/domain/alert-deduplication";

describe("alert deduplication", () => {
  it("deduplicates the same user and project event across searches and retries", () => {
    const daily = {
      userId: "user-1",
      savedSearchId: "search-daily",
      projectId: "project-1",
      triggeringPermitEventId: "event-9",
      alertType: "daily",
    };
    const immediate = {
      ...daily,
      savedSearchId: "search-immediate",
      projectId: "project-merged",
      alertType: "immediate",
    };

    expect(createAlertDeduplicationKey(daily)).toBe(createAlertDeduplicationKey(immediate));
    expect(isDuplicateAlert(immediate, [daily])).toBe(true);
  });

  it("allows different users or triggering events to receive alerts", () => {
    const existing = {
      userId: "user-1",
      projectId: "project-1",
      triggeringPermitEventId: "event-1",
    };

    expect(isDuplicateAlert({ ...existing, userId: "user-2" }, [existing])).toBe(false);
    expect(isDuplicateAlert({ ...existing, triggeringPermitEventId: "event-2" }, [existing])).toBe(
      false,
    );
  });

  it("encodes key parts and accepts the project-event alias", () => {
    expect(
      createAlertDeduplicationKey({
        userId: "user:1",
        projectId: "project/1",
        projectEventId: "event 1",
      }),
    ).toBe("alert:v1:user%3A1:event%201");
  });

  it("requires a triggering event", () => {
    expect(() => createAlertDeduplicationKey({ userId: "u", projectId: "p" })).toThrow(
      "triggeringPermitEventId is required",
    );
  });
});
