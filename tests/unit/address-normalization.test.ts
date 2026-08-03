import { describe, expect, it } from "vitest";

import {
  createNormalizedAddressKey,
  isCompleteCivicStreetAddress,
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

  it("preserves the civic number in Edmonton's spaced address format", () => {
    expect(normalizeEdmontonAddress("5308 - 103A AVENUE NW")).toMatchObject({
      normalizedStreetAddress: "5308 103A AVE NW",
      unitNumber: null,
      siteAddressKey: "edmonton|ab|5308 103a ave nw",
      normalizedAddressKey: "edmonton|ab|5308 103a ave nw",
    });
    expect(normalizeEdmontonAddress("4623 - 103A AVENUE NW")).toMatchObject({
      normalizedStreetAddress: "4623 103A AVE NW",
      unitNumber: null,
    });
    expect(normalizeEdmontonAddress("6120 - 129 AVENUE NW")).toMatchObject({
      normalizedStreetAddress: "6120 129 AVE NW",
      unitNumber: null,
    });
  });

  it("keeps a labelled basement at the same civic site", () => {
    expect(normalizeEdmontonAddress("BSMT, 5310 - 103A AVENUE NW")).toMatchObject({
      normalizedStreetAddress: "5310 103A AVE NW",
      unitNumber: "BSMT",
      siteAddressKey: "edmonton|ab|5310 103a ave nw",
      normalizedAddressKey: "edmonton|ab|5310 103a ave nw|unit:bsmt",
    });
  });

  it("groups City comma-prefixed units at their shared civic site", () => {
    const unit317 = normalizeEdmontonAddress("317, 12025 - 48 AVENUE NW");
    const unitG1 = normalizeEdmontonAddress("G1, 12025 - 48 AVENUE NW");

    expect(unit317).toMatchObject({
      normalizedStreetAddress: "12025 48 AVE NW",
      unitNumber: "317",
      siteAddressKey: "edmonton|ab|12025 48 ave nw",
      normalizedAddressKey: "edmonton|ab|12025 48 ave nw|unit:317",
    });
    expect(unitG1).toMatchObject({
      normalizedStreetAddress: "12025 48 AVE NW",
      unitNumber: "G1",
      siteAddressKey: unit317.siteAddressKey,
      normalizedAddressKey: "edmonton|ab|12025 48 ave nw|unit:g1",
    });
    expect(normalizeEdmontonAddress("202, 6012BK - 104 STREET NW")).toMatchObject({
      normalizedStreetAddress: "6012BK 104 ST NW",
      unitNumber: "202",
      siteAddressKey: "edmonton|ab|6012bk 104 st nw",
    });
  });

  it("recognizes current City street types and named roads", () => {
    expect(normalizeEdmontonAddress("8980 - ELVES LOOP NW").siteAddressKey).toBe(
      "edmonton|ab|8980 elves loop nw",
    );
    expect(normalizeEdmontonAddress("3105 - DIXON LANDING SW").siteAddressKey).toBe(
      "edmonton|ab|3105 dixon landing sw",
    );
    expect(normalizeEdmontonAddress("6322 - KING WYND SW").siteAddressKey).toBe(
      "edmonton|ab|6322 king wynd sw",
    );
    expect(normalizeEdmontonAddress("10547 - KINGSWAY NW").siteAddressKey).toBe(
      "edmonton|ab|10547 kingsway nw",
    );
    expect(normalizeEdmontonAddress("93 - SUNDANCE NW").siteAddressKey).toBe(
      "edmonton|ab|93 sundance nw",
    );
    expect(normalizeEdmontonAddress("52 - KEEGANO NW").siteAddressKey).toBe(
      "edmonton|ab|52 keegano nw",
    );
    expect(normalizeEdmontonAddress("100 - LEWIS FARMS STOP NW").siteAddressKey).toBe(
      "edmonton|ab|100 lewis farms stop nw",
    );
  });

  it("does not mistake ST inside a named road for its final street type", () => {
    expect(normalizeEdmontonAddress("16 - ST GEORGE'S CRESCENT NW")).toMatchObject({
      normalizedStreetAddress: "16 ST GEORGE S CRES NW",
      siteAddressKey: "edmonton|ab|16 st george s cres nw",
    });
  });

  it("recognizes the official type-first Highway 19 address format", () => {
    expect(normalizeEdmontonAddress("19510 - HIGHWAY 19 SW")).toMatchObject({
      normalizedStreetAddress: "19510 HWY 19 SW",
      siteAddressKey: "edmonton|ab|19510 hwy 19 sw",
    });
    expect(normalizeEdmontonAddress("19 HIGHWAY NW").siteAddressKey).toBe("");
  });

  it("does not create an automatic site key without a civic number", () => {
    expect(isCompleteCivicStreetAddress("101A AVE NW")).toBe(false);
    expect(normalizeEdmontonAddress("101A AVE NW").siteAddressKey).toBe("");
    expect(normalizeEdmontonAddress("101A AVENEU NW").siteAddressKey).toBe("");
    expect(normalizeEdmontonAddress("123 GARBAGE NW").siteAddressKey).toBe("");
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
