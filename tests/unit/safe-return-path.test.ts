import { describe, expect, it } from "vitest";
import { safeReturnPath } from "../../src/lib/safe-return-path";

describe("safe return paths", () => {
  it("preserves normalized local paths, queries, and fragments", () => {
    expect(safeReturnPath("/projects?view=list#timeline")).toBe("/projects?view=list#timeline");
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/\\evil.example/",
    decodeURIComponent("/%5Cevil.example/"),
    "not-a-path",
  ])("rejects external or ambiguous redirect target %s", (value) => {
    expect(safeReturnPath(value)).toBe("/");
  });
});
