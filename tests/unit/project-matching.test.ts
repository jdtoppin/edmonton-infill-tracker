import { describe, expect, it } from "vitest";

import {
  findProjectByNormalizedAddress,
  groupByNormalizedAddress,
  matchesProjectAddress,
} from "../../src/domain/project-matching";

describe("project matching by normalized address", () => {
  it("matches formatting variants at the same Edmonton site", () => {
    const projects = [
      { id: "project-1", normalizedStreetAddress: "10830 82 AVE NW" },
      { id: "project-2", normalizedStreetAddress: "10001 95 ST NW" },
    ];

    const result = findProjectByNormalizedAddress(
      { rawAddress: "10830 82 Avenue Northwest, Edmonton AB" },
      projects,
    );

    expect(result).toEqual({
      project: projects[0],
      addressKey: "edmonton|ab|10830 82 ave nw",
      reason: "normalized-site-address",
    });
  });

  it("groups different units into one physical-address project", () => {
    expect(
      matchesProjectAddress(
        { rawAddress: "Unit 1, 12345 67 Street NW" },
        { rawAddress: "2-12345 67 ST NW" },
      ),
    ).toBe(true);
  });

  it("re-canonicalizes a stored street when a legacy key uses another format", () => {
    expect(
      matchesProjectAddress(
        { rawAddress: "99901 - 127 Street Northwest" },
        {
          normalizedStreetAddress: "99901 127 STREET NW",
          normalizedAddressKey: "99901-127-street-nw-edmonton-ab",
        },
      ),
    ).toBe(true);
  });

  it("prefers an exact unit match when legacy duplicate projects exist", () => {
    const projects = [
      {
        id: "b",
        normalizedStreetAddress: "12345 67 ST NW",
        unitNumber: "2",
      },
      {
        id: "a",
        normalizedStreetAddress: "12345 67 ST NW",
        unitNumber: "1",
      },
    ];

    expect(
      findProjectByNormalizedAddress({ rawAddress: "Unit 2, 12345 67 Street NW" }, projects)
        ?.project.id,
    ).toBe("b");
  });

  it("returns no match for an empty or different address", () => {
    expect(
      findProjectByNormalizedAddress({ rawAddress: "" }, [
        { id: "a", rawAddress: "12345 67 ST NW" },
      ]),
    ).toBeNull();
    expect(
      matchesProjectAddress({ rawAddress: "12345 67 ST NW" }, { rawAddress: "12347 67 ST NW" }),
    ).toBe(false);
  });

  it("builds deterministic groups and skips unusable records", () => {
    const records = [
      { rawAddress: "1-10100 100 Street NW", value: "a" },
      { rawAddress: "2-10100 100 ST NW", value: "b" },
      { rawAddress: "", value: "bad" },
    ];

    const grouped = groupByNormalizedAddress(records);
    expect([...grouped.keys()]).toEqual(["edmonton|ab|10100 100 st nw"]);
    expect([...grouped.values()][0]).toEqual(records.slice(0, 2));
  });
});
