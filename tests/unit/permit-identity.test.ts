import { describe, expect, it } from "vitest";

import {
  createPermitIdentity,
  deduplicatePermits,
  isDuplicatePermitIdentity,
} from "../../src/domain/permit-identity";

describe("permit identity and duplicate prevention", () => {
  it("uses provider and source record id as a normalized identity", () => {
    const first = createPermitIdentity({
      sourceProvider: " Edmonton Open Data ",
      sourceRecordIdentifier: " row-123 ",
    });
    const repeated = createPermitIdentity("edmonton open data", "row-123");

    expect(first).toBe(repeated);
    expect(
      isDuplicatePermitIdentity(
        {
          sourceProvider: "EDMONTON OPEN DATA",
          sourceRecordIdentifier: "row-123",
        },
        [first],
      ),
    ).toBe(true);
  });

  it("does not treat a shared permit number as the idempotency key", () => {
    const permits = [
      {
        sourceProvider: "edmonton",
        sourceRecordIdentifier: "record-a",
        permitNumber: "BP-100",
      },
      {
        sourceProvider: "edmonton",
        sourceRecordIdentifier: "record-b",
        permitNumber: "BP-100",
      },
      {
        sourceProvider: "EDMONTON",
        sourceRecordIdentifier: "record-a",
        permitNumber: "BP-100 updated",
      },
    ];

    expect(deduplicatePermits(permits)).toEqual(permits.slice(0, 2));
  });

  it("encodes separators so distinct compound identities cannot collide", () => {
    expect(createPermitIdentity("a:b", "c")).not.toBe(createPermitIdentity("a", "b:c"));
  });

  it("fails fast when an upstream identity component is empty", () => {
    expect(() => createPermitIdentity("edmonton", "  ")).toThrow(
      "sourceRecordIdentifier is required",
    );
  });
});
