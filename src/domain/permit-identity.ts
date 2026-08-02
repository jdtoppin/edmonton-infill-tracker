export interface PermitIdentityInput {
  sourceProvider: string;
  sourceRecordIdentifier: string | number;
}

function requiredIdentityPart(value: string | number, name: string): string {
  const normalized = String(value).trim();
  if (!normalized) {
    throw new Error(`${name} is required to identify a permit event`);
  }
  return normalized;
}

function encodeIdentityPart(value: string): string {
  return encodeURIComponent(value);
}

/**
 * The upstream provider and its record identifier form the idempotency
 * boundary. Permit numbers are not used because a provider can publish
 * multiple independently updated records under one permit number.
 */
export function createPermitIdentity(input: PermitIdentityInput): string;
export function createPermitIdentity(
  sourceProvider: string,
  sourceRecordIdentifier: string | number,
): string;
export function createPermitIdentity(
  inputOrProvider: PermitIdentityInput | string,
  sourceRecordIdentifier?: string | number,
): string {
  const input =
    typeof inputOrProvider === "string"
      ? {
          sourceProvider: inputOrProvider,
          sourceRecordIdentifier: sourceRecordIdentifier ?? "",
        }
      : inputOrProvider;
  const provider = requiredIdentityPart(input.sourceProvider, "sourceProvider").toLowerCase();
  const sourceId = requiredIdentityPart(input.sourceRecordIdentifier, "sourceRecordIdentifier");

  return `permit:v1:${encodeIdentityPart(provider)}:${encodeIdentityPart(sourceId)}`;
}

export function isDuplicatePermitIdentity(
  candidate: PermitIdentityInput,
  existing: Iterable<PermitIdentityInput | string>,
): boolean {
  const candidateKey = createPermitIdentity(candidate);

  for (const item of existing) {
    const existingKey = typeof item === "string" ? item : createPermitIdentity(item);
    if (existingKey === candidateKey) return true;
  }

  return false;
}

export function deduplicatePermits<T extends PermitIdentityInput>(permits: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];

  for (const permit of permits) {
    const key = createPermitIdentity(permit);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(permit);
  }

  return unique;
}
