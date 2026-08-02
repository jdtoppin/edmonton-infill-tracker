import { describe, expect, it } from "vitest";
import { ProjectCategory } from "../../src/generated/prisma/enums";
import { adminProjectActionSchema } from "../../src/services/admin/project-review-request";

const baseOverride = {
  action: "override",
  expectedUpdatedAt: "2026-08-02T12:00:00.000Z",
  reason: "Return this field to automatic classification.",
} as const;

describe("administrator project review requests", () => {
  it("accepts explicit null values that clear durable overrides", () => {
    expect(adminProjectActionSchema.parse({ ...baseOverride, category: null })).toMatchObject({
      category: null,
    });
    expect(adminProjectActionSchema.parse({ ...baseOverride, stage: null })).toMatchObject({
      stage: null,
    });
  });

  it("reserves not-relevant decisions for the confirmed dedicated action", () => {
    expect(() =>
      adminProjectActionSchema.parse({
        ...baseOverride,
        category: ProjectCategory.NOT_RELEVANT,
      }),
    ).toThrow(/dedicated not-relevant/i);
  });
});
