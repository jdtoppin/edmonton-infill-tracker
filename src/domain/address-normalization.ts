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

export const CURRENT_ADDRESS_NORMALIZATION_VERSION = 2;

const STREET_TYPE_ALIASES: Readonly<Record<string, string>> = {
  ACRES: "ACRES",
  ALLEY: "ALY",
  ALLEYWAY: "ALY",
  AV: "AVE",
  AVENUE: "AVE",
  BAY: "BAY",
  BEND: "BEND",
  BLUFF: "BLUFF",
  BLVD: "BLVD",
  BOULEVARD: "BLVD",
  BRIDGE: "BRIDGE",
  CAPE: "CAPE",
  CENTRE: "CENTRE",
  CIRCLE: "CIR",
  CIR: "CIR",
  CL: "CL",
  CLOSE: "CL",
  COMMON: "COMMON",
  COURT: "CT",
  COVE: "COVE",
  CREST: "CREST",
  CRES: "CRES",
  CRESCENT: "CRES",
  CROSSING: "CROSSING",
  CT: "CT",
  DRIVE: "DR",
  DR: "DR",
  END: "END",
  ESTATES: "ESTATES",
  FREEWAY: "FREEWAY",
  GATE: "GATE",
  GARDENS: "GARDENS",
  GREEN: "GREEN",
  GROVE: "GROVE",
  HEATH: "HEATH",
  HEIGHTS: "HTS",
  HILL: "HILL",
  HIGHWAY: "HWY",
  HTS: "HTS",
  HWY: "HWY",
  KEEP: "KEEP",
  KEY: "KEY",
  LANE: "LANE",
  LANDING: "LANDING",
  LINK: "LINK",
  LOOP: "LOOP",
  MALL: "MALL",
  MANOR: "MANOR",
  MAZE: "MAZE",
  MEWS: "MEWS",
  ONE: "ONE",
  PARK: "PARK",
  PARKWAY: "PKWY",
  PLACE: "PL",
  PL: "PL",
  PKWY: "PKWY",
  POINT: "PT",
  POINTE: "POINTE",
  PT: "PT",
  PARADE: "PARADE",
  PASSAGE: "PASSAGE",
  PLAZA: "PLAZA",
  PROMENADE: "PROMENADE",
  RD: "RD",
  RISE: "RISE",
  ROAD: "RD",
  ROW: "ROW",
  RUN: "RUN",
  SQUARE: "SQ",
  SQ: "SQ",
  ST: "ST",
  STATION: "STATION",
  STOP: "STOP",
  STREET: "ST",
  TERRACE: "TER",
  TER: "TER",
  TRAIL: "TRL",
  TRL: "TRL",
  TWO: "TWO",
  VIEW: "VIEW",
  VILLAGE: "VILLAGE",
  VISTA: "VISTA",
  WALK: "WALK",
  WAY: "WAY",
  WYND: "WYND",
  WYNDE: "WYNDE",
};

const STREET_TYPES = new Set(Object.values(STREET_TYPE_ALIASES));
// Verified against the City's current Parcel Addresses dataset. These official
// streets intentionally have no separate type suffix.
const STANDALONE_STREET_NAMES = new Set([
  "HEARTHSTONE",
  "KEEGANO",
  "KINGSWAY",
  "MARLBOROUGH",
  "SOUTHRIDGE",
  "SUNDANCE",
  "WOODSTOCK",
]);

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

/**
 * A complete civic address starts with a building number and includes a
 * separate street name/number before its street type. This distinction matters
 * for Edmonton Open Data, whose canonical civic format is
 * `5308 - 103A AVENUE NW`: the text after the dash is only the street name,
 * not another complete address prefixed by a unit.
 */
export function isCompleteCivicStreetAddress(value: string): boolean {
  const tokens = normalizeStreetAddress(value).split(" ").filter(Boolean);
  if (!/^\d+[A-Z]{0,2}$/.test(tokens[0] ?? "")) return false;

  if (tokens.some((token, index) => index >= 2 && STREET_TYPES.has(token))) return true;

  // Edmonton's Highway 19 civic addresses place the road type before the
  // highway number (`19510 HIGHWAY 19 SW`). Keep this exception numeric so a
  // street-only value such as `19 HIGHWAY NW` still fails closed.
  if (tokens[1] === "HWY" && /^\d+[A-Z]{0,2}$/.test(tokens[2] ?? "")) return true;

  // A few official Edmonton roads do not carry a separate street-type suffix.
  // Keep this allowlist narrow so an unknown or misspelled street-only value
  // cannot be reinterpreted as a complete civic address.
  const firstStreetToken = tokens[1];
  return Boolean(firstStreetToken && STANDALONE_STREET_NAMES.has(firstStreetToken));
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

  const locationLabelled = streetAddress.match(
    /^\s*(BSMT|BASEMENT|MAIN(?:\s+FLOOR)?|UPPER(?:\s+FLOOR)?)\s*,\s*(.+)$/i,
  );
  if (locationLabelled) {
    return {
      streetAddress: locationLabelled[2],
      unitNumber: normalizeUnitNumber(locationLabelled[1]),
    };
  }

  // City rows also use bare unit prefixes such as `317, 12025 - 48 AVENUE`
  // and `G1, 10649 - 68 AVENUE`. The civic-address guard prevents ordinary
  // comma-separated prose from being treated as a unit.
  const commaSeparated = streetAddress.match(/^\s*([A-Z0-9-]{1,30})\s*,\s*(.+)$/i);
  if (commaSeparated && isCompleteCivicStreetAddress(commaSeparated[2])) {
    return {
      streetAddress: commaSeparated[2],
      unitNumber: normalizeUnitNumber(commaSeparated[1]),
    };
  }

  // Edmonton source data commonly represents a unit as "101-12345 67 ST NW".
  // Only treat the prefix as a unit when the right side is itself a complete
  // civic address. Otherwise the dash is the City's building/street separator.
  const hyphenated = streetAddress.match(/^\s*([A-Z0-9]{1,12})\s*-\s*(.+)$/i);
  if (hyphenated && isCompleteCivicStreetAddress(hyphenated[2])) {
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
  return street && isCompleteCivicStreetAddress(street)
    ? `edmonton|ab|${street.toLowerCase()}`
    : "";
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
