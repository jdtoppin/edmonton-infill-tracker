export const PROJECT_STAGE = {
  discovered: "DISCOVERED",
  demolition: "DEMOLITION",
  developmentApplication: "DEVELOPMENT_APPLICATION",
  developmentPermit: "DEVELOPMENT_PERMIT",
  buildingPermit: "BUILDING_PERMIT",
  construction: "CONSTRUCTION",
  inspection: "INSPECTION",
  complete: "COMPLETE",
  cancelled: "CANCELLED",
} as const;

export type ProjectStageValue = (typeof PROJECT_STAGE)[keyof typeof PROJECT_STAGE];

export type ProjectMilestoneType =
  | "OBSERVED"
  | "APPLICATION"
  | "DEMOLITION"
  | "DEVELOPMENT_PERMIT"
  | "BUILDING_PERMIT"
  | "CONSTRUCTION"
  | "INSPECTION"
  | "OCCUPANCY"
  | "OTHER";

export interface TimelinePermitEvent {
  id: string;
  sourceDataset?: string | null;
  permitType?: string | null;
  permitSubtype?: string | null;
  status?: string | null;
  workDescription?: string | null;
  applicationDate?: Date | null;
  issueDate?: Date | null;
  occupancyGrantedDate?: Date | null;
  eventDate?: Date | null;
  createdAt?: Date | null;
  importedAt?: Date | null;
}

export interface ProjectMilestone {
  permitEventId: string;
  type: ProjectMilestoneType;
  stage: ProjectStageValue;
  date: Date;
}

const stageRank: Readonly<Record<Exclude<ProjectStageValue, "CANCELLED">, number>> = {
  DISCOVERED: 0,
  DEMOLITION: 1,
  DEVELOPMENT_APPLICATION: 2,
  DEVELOPMENT_PERMIT: 3,
  BUILDING_PERMIT: 4,
  CONSTRUCTION: 5,
  INSPECTION: 6,
  COMPLETE: 7,
};

function searchable(event: TimelinePermitEvent): string {
  return [event.permitType, event.permitSubtype, event.status, event.workDescription]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function issuedMilestone(event: TimelinePermitEvent): {
  type: ProjectMilestoneType;
  stage: ProjectStageValue;
} {
  const text = searchable(event);
  if (/\b(?:inspection|final inspection)\b/.test(text)) {
    return { type: "INSPECTION", stage: PROJECT_STAGE.inspection };
  }
  if (/\b(?:construction started|under construction|work started)\b/.test(text)) {
    return { type: "CONSTRUCTION", stage: PROJECT_STAGE.construction };
  }
  if (/\b(?:demolition|demolish)\b/.test(text)) {
    return { type: "DEMOLITION", stage: PROJECT_STAGE.demolition };
  }
  if (event.sourceDataset === "development") {
    return { type: "DEVELOPMENT_PERMIT", stage: PROJECT_STAGE.developmentPermit };
  }
  if (event.sourceDataset === "building") {
    return { type: "BUILDING_PERMIT", stage: PROJECT_STAGE.buildingPermit };
  }
  if (/\bdevelopment\b/.test(text)) {
    return { type: "DEVELOPMENT_PERMIT", stage: PROJECT_STAGE.developmentPermit };
  }
  if (/\b(?:building|new house|new dwelling|residential construction)\b/.test(text)) {
    return { type: "BUILDING_PERMIT", stage: PROJECT_STAGE.buildingPermit };
  }
  return { type: "OTHER", stage: PROJECT_STAGE.discovered };
}

function validDate(value: Date | null | undefined): value is Date {
  return value instanceof Date && !Number.isNaN(value.getTime());
}

function edmontonObservationDate(value: Date): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const dateParts = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return new Date(
    Date.UTC(Number(dateParts.year), Number(dateParts.month) - 1, Number(dateParts.day)),
  );
}

/**
 * Returns the non-null date used to order the persisted ProjectEvent link.
 * `createdAt`, `eventDate`, and `importedAt` are observation fallbacks only; callers must use
 * buildProjectMilestones when they need the date's civic meaning.
 */
export function projectEventDate(event: TimelinePermitEvent): Date {
  if (validDate(event.issueDate)) return event.issueDate;
  if (validDate(event.applicationDate)) return event.applicationDate;
  if (validDate(event.occupancyGrantedDate)) return event.occupancyGrantedDate;
  if (validDate(event.createdAt)) return edmontonObservationDate(event.createdAt);
  if (validDate(event.eventDate)) return event.eventDate;
  if (validDate(event.importedAt)) return edmontonObservationDate(event.importedAt);
  throw new Error(`Permit event ${event.id} has no usable timeline date.`);
}

/**
 * Returns when an otherwise-undated source row was first seen by the tracker.
 * This is an observation timestamp, not a City application, issue, or occupancy
 * date, and must never be presented as one of those civic milestones.
 */
function projectObservationDate(event: TimelinePermitEvent): Date | null {
  if (validDate(event.createdAt)) return edmontonObservationDate(event.createdAt);
  if (validDate(event.eventDate)) return event.eventDate;
  if (validDate(event.importedAt)) return edmontonObservationDate(event.importedAt);
  return null;
}

export function buildProjectMilestones(events: readonly TimelinePermitEvent[]): ProjectMilestone[] {
  const milestones: ProjectMilestone[] = [];

  for (const event of events) {
    if (validDate(event.applicationDate)) {
      const applicationStage = /\bdevelopment\b/.test(searchable(event))
        ? PROJECT_STAGE.developmentApplication
        : PROJECT_STAGE.discovered;
      milestones.push({
        permitEventId: event.id,
        type: "APPLICATION",
        stage: applicationStage,
        date: event.applicationDate,
      });
    }
    if (validDate(event.issueDate)) {
      milestones.push({
        permitEventId: event.id,
        date: event.issueDate,
        ...issuedMilestone(event),
      });
    } else if (!validDate(event.applicationDate) && !validDate(event.occupancyGrantedDate)) {
      const observedAt = projectObservationDate(event);
      if (observedAt) {
        milestones.push({
          permitEventId: event.id,
          type: "OBSERVED",
          stage: PROJECT_STAGE.discovered,
          date: observedAt,
        });
      }
    }
    if (validDate(event.occupancyGrantedDate)) {
      milestones.push({
        permitEventId: event.id,
        type: "OCCUPANCY",
        stage: PROJECT_STAGE.complete,
        date: event.occupancyGrantedDate,
      });
    }
  }

  return milestones.sort(
    (left, right) =>
      left.date.getTime() - right.date.getTime() ||
      stageRank[left.stage as Exclude<ProjectStageValue, "CANCELLED">] -
        stageRank[right.stage as Exclude<ProjectStageValue, "CANCELLED">] ||
      left.permitEventId.localeCompare(right.permitEventId) ||
      left.type.localeCompare(right.type),
  );
}

export function determineProjectStage(events: readonly TimelinePermitEvent[]): ProjectStageValue {
  if (events.some((event) => validDate(event.occupancyGrantedDate))) {
    return PROJECT_STAGE.complete;
  }

  const statuses = events
    .map((event) => event.status?.trim().toLowerCase())
    .filter((status): status is string => Boolean(status));
  if (
    events.length > 0 &&
    statuses.length === events.length &&
    statuses.every((status) => /\b(?:cancelled|canceled|withdrawn|void|voided)\b/.test(status))
  ) {
    return PROJECT_STAGE.cancelled;
  }

  return buildProjectMilestones(events).reduce<ProjectStageValue>((highest, milestone) => {
    if (milestone.stage === PROJECT_STAGE.complete) return PROJECT_STAGE.complete;
    const currentRank = stageRank[highest as Exclude<ProjectStageValue, "CANCELLED">] ?? 0;
    const milestoneRank =
      stageRank[milestone.stage as Exclude<ProjectStageValue, "CANCELLED">] ?? 0;
    return milestoneRank > currentRank ? milestone.stage : highest;
  }, PROJECT_STAGE.discovered);
}
