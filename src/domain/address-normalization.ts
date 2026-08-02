export interface EdmontonAddressInput {
  rawAddress?: string | null;
  rawSourceAddress?: string | null;
  streetAddress?: string | null;
  normalizedStreetAddress?: string | null;
  unitNumber?: string | number | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
}

export interface NormalizedEdmontonAddress {
  rawAddress: string;
  rawSourceAddress: string;
  normalizedStreetAddress: string;
  unitNumber: string | null;
  city: "Edmonton";
  province: "AB";
  postalCode: string | null;
  /** A parcel/site key suitable for grouping permits into one project. */
  siteAddressKey: string;
  /** A key that differentiates units when the source supplies one. */
  normalizedAddressKey: string;
}

const STREET_TYPE_ALIASES: Readonly<Record<string, string>> = {
  ALLEY: "ALY",
  ALLEYWAY: "ALY",
  AV: "AVE",
  AVENUE: "AVE",
  BEND: "BEND",
  BLVD: "BLVD",
  BOULEVARD: "BLVD",
  CIRCLE: "CIR",
  CIR: "CIR",
  CL: "CL",
  CLOSE: "CL",
  COMMON: "COMMON",
  COURT: "CT",
  CRES: "CRES",
  CRESCENT: "CRES",
  CT: "CT",
  DRIVE: "DR",
  DR: "DR",
  GATE: "GATE",
  GREEN: "GREEN",
  HEIGHTS: "HTS",
  HIGHWAY: "HWY",
  HTS: "HTS",
  HWY: "HWY",
  LANE: "LANE",
  LINK: "LINK",
  MANOR: "MANOR",
  MEWS: "MEWS",
  PARK: "PARK",
  PARKWAY: "PKWY",
  PLACE: "PL",
  PL: "PL",
  PKWY: "PKWY",
  POINT: "PT",
  PT: "PT",
  RD: "RD",
  ROAD: "RD",
  ROW: "ROW",
  SQUARE: "SQ",
  SQ: "SQ",
  ST: "ST",
  STREET: "ST",
  TERRACE: "TER",
  TER: "TER",
  TRAIL: "TRL",
  TRL: "TRL",
  VIEW: "VIEW",
  WALK: "WALK",
  WAY: "WAY",
};

const DIRECTION_ALIASES: Readonly<Record<string, string>> = {
  N: "N",
  NORTH: "N",
  NE: "NE",
  NORTHEAST: "NE",
  NW: "NW",
  NORTHWEST: "NW",
  S: "S",
  SOUTH: "S",
  SE: "SE",
  SOUTHEAST: "SE",
  SW: "SW",
  SOUTHWEST: "SW",
  E: "E",
  EAST: "E",
  W: "W",
  WEST: "W",
};

const POSTAL_CODE_PATTERN = /\b([A-Z]\d[A-Z])\s*(\d[A-Z]\d)\b/i;

function asciiUpper(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeUnitNumber(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;

  const normalized = asciiUpper(String(value))
    .replace(/^\s*(?:UNIT|SUITE|APT|APARTMENT|#)\s*/i, "")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/^-+|-+$/g, "");

  return normalized || null;
}

function extractUnit(streetAddress: string): {
  streetAddress: string;
  unitNumber: string | null;
} {
  const labelled = streetAddress.match(
    /^\s*(?:UNIT|SUITE|APT|APARTMENT|#)\s*([A-Z0-9-]+)\s*[,/-]?\s+(.+)$/i,
  );
  if (labelled) {
    return {
      streetAddress: labelled[2],
      unitNumber: normalizeUnitNumber(labelled[1]),
    };
  }

  // Edmonton source data commonly represents a unit as "101-12345 67 ST NW".
  const hyphenated = streetAddress.match(/^\s*([A-Z0-9]{1,4})\s*-\s*(\d{3,}[A-Z]?\s+.+)$/i);
  if (hyphenated) {
    return {
      streetAddress: hyphenated[2],
      unitNumber: normalizeUnitNumber(hyphenated[1]),
    };
  }

  return { streetAddress, unitNumber: null };
}

function stripLocationSuffix(value: string): string {
  return value
    .replace(POSTAL_CODE_PATTERN, " ")
    .replace(/\b(?:EDMONTON)\b/gi, " ")
    .replace(/\b(?:ALBERTA|AB)\b/gi, " ");
}

/**
 * Canonicalizes an Edmonton civic street address without retaining a unit.
 * Postal code, city, and province are intentionally excluded from the street
 * value because public datasets do not supply them consistently.
 */
export function normalizeStreetAddress(value: string): string {
  const prepared = asciiUpper(stripLocationSuffix(value))
    .replace(/\b(NORTH|SOUTH)\s+(EAST|WEST)\b/g, "$1$2")
    .replace(/\b([NS])\s*\.?\s*([EW])\b/g, "$1$2")
    .replace(/[.,;:'"()]/g, " ")
    .replace(/[-/\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!prepared) return "";

  return prepared
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      const withoutOrdinal = token.replace(/^(\d+)(?:ST|ND|RD|TH)$/i, "$1");
      return (
        STREET_TYPE_ALIASES[withoutOrdinal] ?? DIRECTION_ALIASES[withoutOrdinal] ?? withoutOrdinal
      );
    })
    .join(" ");
}

export function normalizePostalCode(value: string | null | undefined): string | null {
  if (!value) return null;
  const compact = asciiUpper(value).replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]\d[A-Z]\d[A-Z]\d$/.test(compact)
    ? `${compact.slice(0, 3)} ${compact.slice(3)}`
    : null;
}

export function createSiteAddressKey(normalizedStreetAddress: string): string {
  const street = normalizeStreetAddress(normalizedStreetAddress);
  return street ? `edmonton|ab|${street.toLowerCase()}` : "";
}

export function createNormalizedAddressKey(
  normalizedStreetAddress: string,
  unitNumber?: string | number | null,
): string {
  const siteKey = createSiteAddressKey(normalizedStreetAddress);
  if (!siteKey) return "";

  const unit = normalizeUnitNumber(unitNumber);
  return unit ? `${siteKey}|unit:${unit.toLowerCase()}` : siteKey;
}

export function normalizeEdmontonAddress(
  input: string | EdmontonAddressInput,
): NormalizedEdmontonAddress {
  const addressInput: EdmontonAddressInput =
    typeof input === "string" ? { rawAddress: input } : input;
  const rawAddress = (
    addressInput.rawAddress ??
    addressInput.rawSourceAddress ??
    addressInput.streetAddress ??
    addressInput.normalizedStreetAddress ??
    ""
  ).trim();
  const streetAddress = (
    addressInput.streetAddress ??
    addressInput.normalizedStreetAddress ??
    addressInput.rawAddress ??
    addressInput.rawSourceAddress ??
    ""
  ).trim();
  const extracted = extractUnit(streetAddress);
  const normalizedStreetAddress = normalizeStreetAddress(extracted.streetAddress);
  const unitNumber = normalizeUnitNumber(addressInput.unitNumber) ?? extracted.unitNumber;
  const postalFromRaw = `${rawAddress} ${streetAddress}`.match(POSTAL_CODE_PATTERN);
  const postalCode = normalizePostalCode(
    addressInput.postalCode ?? (postalFromRaw ? `${postalFromRaw[1]}${postalFromRaw[2]}` : null),
  );
  const siteAddressKey = createSiteAddressKey(normalizedStreetAddress);

  return {
    rawAddress,
    rawSourceAddress: rawAddress,
    normalizedStreetAddress,
    unitNumber,
    city: "Edmonton",
    province: "AB",
    postalCode,
    siteAddressKey,
    normalizedAddressKey: createNormalizedAddressKey(normalizedStreetAddress, unitNumber),
  };
}
