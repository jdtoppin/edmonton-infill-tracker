import {
  createNormalizedAddressKey,
  createSiteAddressKey,
  normalizeEdmontonAddress,
} from "./address-normalization";

export interface AddressMatchFields {
  rawAddress?: string | null;
  rawSourceAddress?: string | null;
  normalizedStreetAddress?: string | null;
  unitNumber?: string | number | null;
  siteAddressKey?: string | null;
  normalizedAddressKey?: string | null;
  address?: AddressMatchFields | null;
}

export interface ProjectAddressMatch<TProject> {
  project: TProject;
  addressKey: string;
  reason: "normalized-site-address";
}

function withoutUnitSuffix(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/\|unit:[^|]+$/i, "");
}

export function getSiteAddressKey(value: AddressMatchFields): string {
  const address = value.address ?? value;

  if (address.siteAddressKey?.trim()) {
    return withoutUnitSuffix(address.siteAddressKey);
  }
  if (address.normalizedStreetAddress?.trim()) {
    return createSiteAddressKey(address.normalizedStreetAddress);
  }
  const rawAddress = address.rawAddress ?? address.rawSourceAddress;
  if (rawAddress?.trim()) {
    return normalizeEdmontonAddress(rawAddress).siteAddressKey;
  }
  if (address.normalizedAddressKey?.trim()) {
    return withoutUnitSuffix(address.normalizedAddressKey);
  }

  return "";
}

function getUnitAddressKey(value: AddressMatchFields): string {
  const address = value.address ?? value;

  if (address.normalizedStreetAddress?.trim()) {
    return createNormalizedAddressKey(address.normalizedStreetAddress, address.unitNumber);
  }
  const rawAddress = address.rawAddress ?? address.rawSourceAddress;
  if (rawAddress?.trim()) {
    return normalizeEdmontonAddress({
      rawAddress,
      unitNumber: address.unitNumber,
    }).normalizedAddressKey;
  }
  if (address.normalizedAddressKey?.trim()) {
    return address.normalizedAddressKey.trim().toLowerCase();
  }

  return "";
}

/**
 * Finds a project at the same civic/site address. Unit differences are ignored
 * so permits for a suite, demolition, and replacement dwelling share a single
 * physical-address timeline. When duplicate project candidates exist, an exact
 * unit match wins and then the stable project id breaks ties.
 */
export function findProjectByNormalizedAddress<
  TProject extends AddressMatchFields & { id?: string | number },
>(permit: AddressMatchFields, projects: readonly TProject[]): ProjectAddressMatch<TProject> | null {
  const permitSiteKey = getSiteAddressKey(permit);
  if (!permitSiteKey) return null;

  const permitUnitKey = getUnitAddressKey(permit);
  const matching = projects.filter((project) => getSiteAddressKey(project) === permitSiteKey);
  if (matching.length === 0) return null;

  const [project] = [...matching].sort((left, right) => {
    const leftExact = permitUnitKey !== "" && getUnitAddressKey(left) === permitUnitKey ? 1 : 0;
    const rightExact = permitUnitKey !== "" && getUnitAddressKey(right) === permitUnitKey ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;

    return String(left.id ?? "").localeCompare(String(right.id ?? ""));
  });

  return {
    project,
    addressKey: permitSiteKey,
    reason: "normalized-site-address",
  };
}

export function matchesProjectAddress(
  permit: AddressMatchFields,
  project: AddressMatchFields,
): boolean {
  const permitKey = getSiteAddressKey(permit);
  return permitKey !== "" && permitKey === getSiteAddressKey(project);
}

export function groupByNormalizedAddress<T extends AddressMatchFields>(
  records: readonly T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const record of records) {
    const key = getSiteAddressKey(record);
    if (!key) continue;
    const group = grouped.get(key);
    if (group) group.push(record);
    else grouped.set(key, [record]);
  }

  return grouped;
}
