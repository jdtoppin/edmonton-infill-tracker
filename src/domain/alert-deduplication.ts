export interface AlertDeduplicationInput {
  userId: string | number;
  projectId?: string | number | null;
  triggeringPermitEventId?: string | number | null;
  projectEventId?: string | number | null;
  savedSearchId?: string | number | null;
  alertType?: string | null;
}

function requiredPart(value: string | number | null | undefined, name: string): string {
  if (value === null || value === undefined || String(value).trim() === "") {
    throw new Error(`${name} is required to deduplicate an alert`);
  }
  return String(value).trim();
}

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

/**
 * Project, saved search, and delivery frequency are intentionally excluded.
 * A permit event belongs to one project, and the product invariant is one alert
 * per user/event even if a project is later merged or an event is reassigned.
 */
export function createAlertDeduplicationKey(input: AlertDeduplicationInput): string {
  const userId = requiredPart(input.userId, "userId");
  const eventId = requiredPart(
    input.triggeringPermitEventId ?? input.projectEventId,
    "triggeringPermitEventId",
  );

  return `alert:v1:${encodePart(userId)}:${encodePart(eventId)}`;
}

export function isDuplicateAlert(
  candidate: AlertDeduplicationInput,
  existing: Iterable<AlertDeduplicationInput | string>,
): boolean {
  const candidateKey = createAlertDeduplicationKey(candidate);

  for (const alert of existing) {
    const key = typeof alert === "string" ? alert : createAlertDeduplicationKey(alert);
    if (key === candidateKey) return true;
  }

  return false;
}
