import { describe, expect, it } from "vitest";

import {
  createNormalizedAddressKey,
  normalizeEdmontonAddress,
  normalizePostalCode,
  normalizeStreetAddress,
} from "../../src/domain/address-normalization";

describe("Edmonton address normalization", () => {
  it("normalizes common Edmonton suffixes, directions, location, and postal code", () => {
    const address = normalizeEdmontonAddress(
      "Unit 204, 10830 82 Avenue Northwest, Edmonton, AB T6E 2B3",
    );

    expect(address).toEqual({
      rawAddress: "Unit 204, 10830 82 Avenue Northwest, Edmonton, AB T6E 2B3",
      rawSourceAddress: "Unit 204, 10830 82 Avenue Northwest, Edmonton, AB T6E 2B3",
      normalizedStreetAddress: "10830 82 AVE NW",
      unitNumber: "204",
      city: "Edmonton",
      province: "AB",
      postalCode: "T6E 2B3",
      siteAddressKey: "edmonton|ab|10830 82 ave nw",
      normalizedAddressKey: "edmonton|ab|10830 82 ave nw|unit:204",
    });
  });

  it("produces the same deterministic keys across source formatting variants", () => {
    const labelled = normalizeEdmontonAddress("Unit 204, 10830 82 Avenue Northwest");
    const hyphenated = normalizeEdmontonAddress("204-10830 82 AVE NORTH WEST");

    expect(hyphenated.normalizedStreetAddress).toBe("10830 82 AVE NW");
    expect(hyphenated.siteAddressKey).toBe(labelled.siteAddressKey);
    expect(hyphenated.normalizedAddressKey).toBe(labelled.normalizedAddressKey);
  });

  it("canonicalizes ordinal street numbers and common street types", () => {
    expect(normalizeStreetAddress("12345 101st Street N.W.")).toBe("12345 101 ST NW");
    expect(normalizeStreetAddress("9007 Saskatchewan Drive NW")).toBe("9007 SASKATCHEWAN DR NW");
    expect(normalizeEdmontonAddress("99901 - 127 STREET NW").unitNumber).toBeNull();
    expect(normalizeStreetAddress("99901 - 127 STREET NW")).toBe("99901 127 ST NW");
  });

  it("keeps the site key stable while making a unit-specific key available", () => {
    const base = createNormalizedAddressKey("12345 67 Street NW");
    const unit = createNormalizedAddressKey("12345 67 ST NW", "Suite A-2");

    expect(base).toBe("edmonton|ab|12345 67 st nw");
    expect(unit).toBe("edmonton|ab|12345 67 st nw|unit:a-2");
  });

  it("rejects malformed postal codes rather than creating unstable values", () => {
    expect(normalizePostalCode("t6e2b3")).toBe("T6E 2B3");
    expect(normalizePostalCode("not available")).toBeNull();
  });
});
