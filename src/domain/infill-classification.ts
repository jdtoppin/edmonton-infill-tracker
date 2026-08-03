import { DEFAULT_INFILL_SCORING_CONFIG, type InfillScoringConfig } from "./infill-scoring-config";

/** Persistence-compatible literals kept here to avoid a generated-client dependency. */
export const INFILL_PROJECT_CATEGORY = {
  probableNewDetachedInfill: "PROBABLE_NEW_DETACHED_INFILL",
  probableNewDetachedInfillForMarket: "PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE",
  probableSemiDetachedInfill: "PROBABLE_SEMI_DETACHED_INFILL",
  probableDuplex: "PROBABLE_DUPLEX",
  probableRowHousing: "PROBABLE_ROW_HOUSING",
  probableGardenSuite: "PROBABLE_GARDEN_SUITE",
  demolitionOnly: "DEMOLITION_ONLY",
  renovationOrAddition: "RENOVATION_OR_ADDITION",
  uncertainResidentialDevelopment: "UNCERTAIN_RESIDENTIAL_DEVELOPMENT",
  notRelevant: "NOT_RELEVANT",
} as const;

export type InfillProjectCategory =
  (typeof INFILL_PROJECT_CATEGORY)[keyof typeof INFILL_PROJECT_CATEGORY];

export const INFILL_PROJECT_CATEGORY_LABELS: Readonly<Record<InfillProjectCategory, string>> = {
  [INFILL_PROJECT_CATEGORY.probableNewDetachedInfill]: "Probable new detached infill",
  [INFILL_PROJECT_CATEGORY.probableNewDetachedInfillForMarket]:
    "Probable new detached infill that will hit realtor.ca",
  [INFILL_PROJECT_CATEGORY.probableSemiDetachedInfill]: "Probable semi-detached infill",
  [INFILL_PROJECT_CATEGORY.probableDuplex]: "Probable duplex",
  [INFILL_PROJECT_CATEGORY.probableRowHousing]: "Probable row housing",
  [INFILL_PROJECT_CATEGORY.probableGardenSuite]: "Probable garden suite",
  [INFILL_PROJECT_CATEGORY.demolitionOnly]: "Demolition only",
  [INFILL_PROJECT_CATEGORY.renovationOrAddition]: "Renovation or addition",
  [INFILL_PROJECT_CATEGORY.uncertainResidentialDevelopment]: "Uncertain residential development",
  [INFILL_PROJECT_CATEGORY.notRelevant]: "Not relevant",
};

export interface InfillPermitEvent {
  sourceDataset?: string | null;
  permitType?: string | null;
  permitSubtype?: string | null;
  status?: string | null;
  workDescription?: string | null;
  buildingType?: string | null;
  unitsAdded?: number | null;
  constructionValue?: number | null;
  applicationDate?: string | Date | null;
  issueDate?: string | Date | null;
  occupancyGrantedDate?: string | Date | null;
  eventDate?: string | Date | null;
  /** Stable tracker observation time, used only to order otherwise-undated evidence. */
  observedAt?: string | Date | null;
  /** Defaults to true; set false when evaluating an unverified related event. */
  sameAddress?: boolean;
}

export interface InfillClassificationInput {
  events: readonly InfillPermitEvent[];
  neighbourhood?: string | null;
  estimatedUnits?: number | null;
  estimatedConstructionValue?: number | null;
  /** A separate marketplace/social signal; permit language never infers this. */
  marketListingSignal?: boolean;
}

export type InfillScoringRule =
  keyof InfillScoringConfig["weights"] | "commercialOrIndustrialExclusion";

export interface InfillScoreExplanation {
  rule: InfillScoringRule;
  points: number;
  message: string;
}

export interface InfillTimelineAnalysis {
  demolitionToConstructionDays: number | null;
  withinConfiguredWindow: boolean;
}

export interface InfillClassificationResult {
  category: InfillProjectCategory;
  confidenceScore: number;
  scoreExplanation: InfillScoreExplanation[];
  plainLanguageExplanation: string;
  timeline: InfillTimelineAnalysis;
  episode: InfillEpisodeSelection;
}

export const INFILL_EVENT_ROLE = {
  principalResidential: "PRINCIPAL_RESIDENTIAL",
  principalDemolition: "PRINCIPAL_DEMOLITION",
  residentialSupporting: "RESIDENTIAL_SUPPORTING",
  propertyOnly: "PROPERTY_ONLY",
  excluded: "EXCLUDED",
} as const;

export type InfillEventRole = (typeof INFILL_EVENT_ROLE)[keyof typeof INFILL_EVENT_ROLE];

export interface InfillEventAssessment {
  event: InfillPermitEvent;
  role: InfillEventRole;
  demolition: boolean;
  newResidentialConstruction: boolean;
  accessoryOrPropertyOnly: boolean;
  inactive: boolean;
  commercialOrIndustrial: boolean;
  sourceStartDate: Date | null;
  sourceEndDate: Date | null;
  orderingDate: Date | null;
}

export interface InfillEpisodeSelection {
  events: readonly InfillPermitEvent[];
  assessments: readonly InfillEventAssessment[];
  allAssessments: readonly InfillEventAssessment[];
  infillStartDate: Date | null;
  latestInfillActivityDate: Date | null;
  orderingStartDate: Date | null;
  orderingEndDate: Date | null;
}

interface EventSignals {
  event: InfillPermitEvent;
  allText: string;
  descriptionText: string;
  permitText: string;
  demolition: boolean;
  developmentPermit: boolean;
  buildingPermit: boolean;
  residentialBuilding: boolean;
  renovation: boolean;
  inactive: boolean;
  accessoryOrPropertyOnly: boolean;
  commercialOrIndustrial: boolean;
  newDwellingLanguage: boolean;
  newResidentialConstruction: boolean;
  eventTime: number | null;
}

function searchable(...values: Array<string | null | undefined>): string {
  return values
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKeyword(keyword: string): string {
  return searchable(keyword);
}

function containsAny(text: string, keywords: readonly string[]): boolean {
  const paddedText = ` ${text} `;
  return keywords.some((keyword) => paddedText.includes(` ${normalizedKeyword(keyword)} `));
}

function parsedTime(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sourceEventTimes(event: InfillPermitEvent): number[] {
  return [
    parsedTime(event.applicationDate),
    parsedTime(event.issueDate),
    parsedTime(event.occupancyGrantedDate),
    parsedTime(event.eventDate),
  ].filter((value): value is number => value !== null);
}

function getEventTime(event: InfillPermitEvent): number | null {
  return (
    parsedTime(event.issueDate) ??
    parsedTime(event.applicationDate) ??
    parsedTime(event.eventDate) ??
    parsedTime(event.occupancyGrantedDate)
  );
}

function eventSignals(event: InfillPermitEvent, config: InfillScoringConfig): EventSignals {
  const descriptionText = searchable(event.workDescription);
  const permitText = searchable(event.permitType, event.permitSubtype);
  const formText = searchable(event.permitSubtype, event.workDescription, event.buildingType);
  const allText = searchable(
    event.permitType,
    event.permitSubtype,
    event.workDescription,
    event.buildingType,
  );
  const residentialBuilding = containsAny(
    searchable(event.buildingType, event.permitSubtype, event.workDescription),
    config.keywords.residentialBuilding,
  );
  const renovation = containsAny(descriptionText, config.keywords.renovation);
  const categorySpecificConstruction = containsAny(formText, [
    ...config.keywords.detached,
    ...config.keywords.semiDetached,
    ...config.keywords.duplex,
    ...config.keywords.rowHousing,
    ...config.keywords.gardenSuite,
  ]);
  const newConstructionIndicator =
    /\bnew\b/.test(allText) || containsAny(allText, config.keywords.newConstruction);
  const configuredNewDwelling = containsAny(descriptionText, config.keywords.newDwelling);
  const flexibleNewDwelling =
    /\bnew(?:\s+(?:one|two|three|four|\d+|single|semi|detached|residential|principal|storey|story)){0,6}\s+(?:dwelling|house)\b/.test(
      descriptionText,
    );
  const newDwellingLanguage = configuredNewDwelling || flexibleNewDwelling;
  const habitableText = searchable(event.permitSubtype, event.workDescription);
  const demolitionLanguage = containsAny(allText, config.keywords.demolition);
  const principalResidentialForm =
    /\b(?:single detached (?:house|dwelling)|detached (?:house|dwelling)|semi detached (?:house|dwelling)|duplex|row (?:house|housing|dwelling)|townhouse|town house|garden suite|garage suite|backyard house|cluster housing)\b/.test(
      habitableText,
    );
  const principalConstructionLanguage =
    /\b(?:construct|build|erect|construction of)\s+(?:(?:a|an|the)\s+)?(?:new\s+)?(?:(?:one|two|three|four|\d+)\s+(?:storey|story)\s+)?(?:residential use\s+)?(?:\d+\s+)?(?:dwelling(?:s)?(?:\s+units?)?(?:\s+of)?\s+)?(?:single detached (?:house|dwelling)|detached (?:house|dwelling)|semi detached (?:house|dwelling)|duplex|row (?:house|housing|dwelling)|townhouse|town house|garden suite|garage suite|backyard house|cluster housing)\b/.test(
      habitableText,
    ) ||
    /\b(?:construct|build|erect)\s+(?:a\s+)?residential use (?:building|development) in the form of\s+(?:a\s+)?(?:\d+\s+)?(?:dwelling(?:s)?(?:\s+units?)?(?:\s+of)?\s+)?(?:single detached (?:house|dwelling)|detached (?:house|dwelling)|semi detached (?:house|dwelling)|duplex|row (?:house|housing|dwelling)|townhouse|town house|garden suite|garage suite|backyard house|cluster housing)\b/.test(
      habitableText,
    );
  const principalHouseCombo =
    /\bhouse (?:combo|combination)(?: permit)?\b/.test(permitText) && newConstructionIndicator;
  const gardenSuiteLanguage = containsAny(habitableText, config.keywords.gardenSuite);
  const suiteRemovalOrUseChange =
    /\b(?:remove|demolish)(?:d|ed|ing)?\s+(?:(?:an|the|existing)\s+)?(?:garden suite|garage suite|backyard house)\b/.test(
      descriptionText,
    ) ||
    /\b(?:garden suite|garage suite|backyard house)\s+(?:(?:is|to be)\s+)?(?:removed|demolished)\b/.test(
      descriptionText,
    ) ||
    /\b(?:change|changing) (?:the )?use\b/.test(descriptionText) ||
    /\bconvert(?:ed|ing)?\b/.test(descriptionText);
  const positiveGardenSuiteConstruction =
    gardenSuiteLanguage && newConstructionIndicator && !renovation && !suiteRemovalOrUseChange;
  const explicitHabitableUse =
    newDwellingLanguage ||
    positiveGardenSuiteConstruction ||
    principalConstructionLanguage ||
    principalHouseCombo;
  const accessoryOrPropertyOnly =
    containsAny(allText, config.keywords.propertyOnly) &&
    !explicitHabitableUse &&
    !(demolitionLanguage && principalResidentialForm);
  const inactive = containsAny(searchable(event.status), config.keywords.inactiveStatus);
  const commercialOrIndustrial = containsAny(allText, config.keywords.commercialOrIndustrial);
  const explicitNewPermit = /\bnew\b/.test(permitText);
  const explicitResidentialConstruction =
    explicitHabitableUse ||
    (!renovation && !demolitionLanguage && categorySpecificConstruction && explicitNewPermit) ||
    (!renovation &&
      !demolitionLanguage &&
      newConstructionIndicator &&
      residentialBuilding &&
      typeof event.unitsAdded === "number" &&
      event.unitsAdded > 0);
  const newResidentialConstruction =
    !inactive &&
    !accessoryOrPropertyOnly &&
    !commercialOrIndustrial &&
    explicitResidentialConstruction;

  const sourceDatasetKnown =
    event.sourceDataset === "development" || event.sourceDataset === "building";

  return {
    event,
    allText,
    descriptionText,
    permitText,
    demolition:
      !inactive && !accessoryOrPropertyOnly && !commercialOrIndustrial && demolitionLanguage,
    developmentPermit:
      event.sourceDataset === "development" ||
      (!sourceDatasetKnown &&
        (containsAny(permitText, config.keywords.developmentPermit) ||
          /\bdevelopment\b/.test(permitText))),
    buildingPermit:
      event.sourceDataset === "building" ||
      (!sourceDatasetKnown &&
        (containsAny(permitText, config.keywords.buildingPermit) ||
          /\bbuilding\b/.test(permitText))),
    residentialBuilding:
      residentialBuilding && !inactive && !accessoryOrPropertyOnly && !commercialOrIndustrial,
    renovation: renovation && !inactive && !accessoryOrPropertyOnly && !commercialOrIndustrial,
    inactive,
    accessoryOrPropertyOnly,
    commercialOrIndustrial,
    newDwellingLanguage,
    newResidentialConstruction,
    eventTime: getEventTime(event),
  };
}

function dateFromTime(value: number | null): Date | null {
  return value === null ? null : new Date(value);
}

export function assessInfillPermitEvent(
  event: InfillPermitEvent,
  config: InfillScoringConfig = DEFAULT_INFILL_SCORING_CONFIG,
): InfillEventAssessment {
  const signal = eventSignals(event, config);
  const sourceTimes = sourceEventTimes(event);
  const sourceStartTime = sourceTimes.length > 0 ? Math.min(...sourceTimes) : null;
  const sourceEndTime = sourceTimes.length > 0 ? Math.max(...sourceTimes) : null;
  const observedTime = parsedTime(event.observedAt);
  const orderingTime = sourceEndTime ?? observedTime;
  const role: InfillEventRole = signal.accessoryOrPropertyOnly
    ? INFILL_EVENT_ROLE.propertyOnly
    : signal.inactive
      ? INFILL_EVENT_ROLE.excluded
      : signal.commercialOrIndustrial
        ? INFILL_EVENT_ROLE.excluded
        : signal.demolition
          ? INFILL_EVENT_ROLE.principalDemolition
          : signal.newResidentialConstruction
            ? INFILL_EVENT_ROLE.principalResidential
            : signal.renovation ||
                signal.residentialBuilding ||
                (typeof event.unitsAdded === "number" && event.unitsAdded > 0)
              ? INFILL_EVENT_ROLE.residentialSupporting
              : INFILL_EVENT_ROLE.propertyOnly;

  return {
    event,
    role,
    demolition: signal.demolition,
    newResidentialConstruction: signal.newResidentialConstruction,
    accessoryOrPropertyOnly: signal.accessoryOrPropertyOnly,
    inactive: signal.inactive,
    commercialOrIndustrial: signal.commercialOrIndustrial,
    sourceStartDate: dateFromTime(sourceStartTime),
    sourceEndDate: dateFromTime(sourceEndTime),
    orderingDate: dateFromTime(orderingTime),
  };
}

interface MutableEpisode {
  assessments: InfillEventAssessment[];
  orderingStartTime: number;
  orderingEndTime: number;
}

/**
 * Selects the latest coherent infill episode at an address. Consecutive
 * qualifying records first establish episode continuity, then the selected
 * episode is capped at the configured lookback from its latest milestone.
 * Property-only and inactive records never bridge otherwise separate projects.
 */
export function selectLatestInfillEpisode(
  events: readonly InfillPermitEvent[],
  config: InfillScoringConfig = DEFAULT_INFILL_SCORING_CONFIG,
): InfillEpisodeSelection {
  const allAssessments = events.map((event) => assessInfillPermitEvent(event, config));
  const eligible = allAssessments.filter(
    ({ role }) => role !== INFILL_EVENT_ROLE.propertyOnly && role !== INFILL_EVENT_ROLE.excluded,
  );
  const undated = eligible.filter(({ orderingDate }) => orderingDate === null);
  const qualifying = eligible
    .filter(
      (assessment): assessment is InfillEventAssessment & { orderingDate: Date } =>
        assessment.orderingDate !== null,
    )
    .sort((left, right) => {
      const leftTime = left.sourceStartDate?.getTime() ?? left.orderingDate.getTime();
      const rightTime = right.sourceStartDate?.getTime() ?? right.orderingDate.getTime();
      return leftTime - rightTime;
    });
  const maximumGapMilliseconds = config.maxEpisodeGapDays * 24 * 60 * 60 * 1_000;
  const episodes: MutableEpisode[] = [];

  for (const assessment of qualifying) {
    const sourceStartTime = assessment.sourceStartDate?.getTime();
    const orderingTime = assessment.orderingDate.getTime();
    const startTime = sourceStartTime ?? orderingTime;
    const endTime = assessment.sourceEndDate?.getTime() ?? orderingTime;
    const current = episodes.at(-1);
    if (!current || startTime - current.orderingEndTime > maximumGapMilliseconds) {
      episodes.push({
        assessments: [assessment],
        orderingStartTime: startTime,
        orderingEndTime: endTime,
      });
    } else {
      current.assessments.push(assessment);
      current.orderingStartTime = Math.min(current.orderingStartTime, startTime);
      current.orderingEndTime = Math.max(current.orderingEndTime, endTime);
    }
  }

  const selected = episodes.at(-1);
  if (!selected && undated.length > 0) {
    return {
      events: undated.map(({ event }) => event),
      assessments: undated,
      allAssessments,
      infillStartDate: null,
      latestInfillActivityDate: null,
      orderingStartDate: null,
      orderingEndDate: null,
    };
  }
  if (!selected) {
    return {
      events: [],
      assessments: [],
      allAssessments,
      infillStartDate: null,
      latestInfillActivityDate: null,
      orderingStartDate: null,
      orderingEndDate: null,
    };
  }

  const selectedCutoffTime = selected.orderingEndTime - maximumGapMilliseconds;
  const selectedAssessments = selected.assessments.filter(
    ({ orderingDate }) => orderingDate && orderingDate.getTime() >= selectedCutoffTime,
  );
  const sourceStarts = selectedAssessments.flatMap(({ sourceStartDate }) =>
    sourceStartDate ? [sourceStartDate.getTime()] : [],
  );
  const sourceEnds = selectedAssessments.flatMap(({ sourceEndDate }) =>
    sourceEndDate ? [sourceEndDate.getTime()] : [],
  );
  const orderingStarts = selectedAssessments.flatMap(({ sourceStartDate, orderingDate }) => {
    const date = sourceStartDate ?? orderingDate;
    return date ? [date.getTime()] : [];
  });
  return {
    events: selectedAssessments.map(({ event }) => event),
    assessments: selectedAssessments,
    allAssessments,
    infillStartDate: dateFromTime(sourceStarts.length > 0 ? Math.min(...sourceStarts) : null),
    latestInfillActivityDate: dateFromTime(sourceEnds.length > 0 ? Math.max(...sourceEnds) : null),
    orderingStartDate: dateFromTime(
      orderingStarts.length > 0 ? Math.min(...orderingStarts) : selected.orderingStartTime,
    ),
    orderingEndDate: new Date(selected.orderingEndTime),
  };
}

function analyzeTimeline(
  signals: readonly EventSignals[],
  windowDays: number,
): InfillTimelineAnalysis {
  const demolitionTimes = signals
    .filter(
      (signal) =>
        signal.demolition && signal.event.sameAddress !== false && signal.eventTime !== null,
    )
    .map((signal) => signal.eventTime as number);
  const constructionTimes = signals
    .filter((signal) => signal.newResidentialConstruction && signal.eventTime !== null)
    .map((signal) => signal.eventTime as number);

  let closestDays: number | null = null;
  for (const demolitionTime of demolitionTimes) {
    for (const constructionTime of constructionTimes) {
      if (constructionTime < demolitionTime) continue;
      const days = Math.floor((constructionTime - demolitionTime) / (24 * 60 * 60 * 1_000));
      if (closestDays === null || days < closestDays) closestDays = days;
    }
  }

  return {
    demolitionToConstructionDays: closestDays,
    withinConfiguredWindow: closestDays !== null && closestDays <= windowDays,
  };
}

function maxNumeric(values: ReadonlyArray<number | null | undefined>): number | null {
  const finite = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  );
  return finite.length > 0 ? Math.max(...finite) : null;
}

function determineCategory(
  input: InfillClassificationInput,
  signals: readonly EventSignals[],
  config: InfillScoringConfig,
  commercialOrIndustrial: boolean,
): InfillProjectCategory {
  if (commercialOrIndustrial) return INFILL_PROJECT_CATEGORY.notRelevant;

  // Edmonton's JOB_CATEGORY can be the combined label
  // "Single, Semi-detached & Rowhousing". It identifies a broad permit family,
  // not the form being built, so prefer subtype/description/building type when
  // selecting a specific project category.
  const formText = signals
    .filter((signal) => signal.newResidentialConstruction)
    .map(({ event }) => searchable(event.permitSubtype, event.workDescription, event.buildingType))
    .join(" ");
  const hasNewConstruction = signals.some((signal) => signal.newResidentialConstruction);
  const hasDemolition = signals.some(
    (signal) => signal.demolition && signal.event.sameAddress !== false,
  );
  const hasRenovation = signals.some((signal) => signal.renovation);

  if (hasNewConstruction) {
    if (containsAny(formText, config.keywords.gardenSuite)) {
      return INFILL_PROJECT_CATEGORY.probableGardenSuite;
    }
    if (containsAny(formText, config.keywords.rowHousing)) {
      return INFILL_PROJECT_CATEGORY.probableRowHousing;
    }
    if (containsAny(formText, config.keywords.semiDetached)) {
      return INFILL_PROJECT_CATEGORY.probableSemiDetachedInfill;
    }
    if (containsAny(formText, config.keywords.duplex)) {
      return INFILL_PROJECT_CATEGORY.probableDuplex;
    }
    if (containsAny(formText, config.keywords.detached)) {
      return input.marketListingSignal
        ? INFILL_PROJECT_CATEGORY.probableNewDetachedInfillForMarket
        : INFILL_PROJECT_CATEGORY.probableNewDetachedInfill;
    }
    return INFILL_PROJECT_CATEGORY.uncertainResidentialDevelopment;
  }
  if (hasDemolition) return INFILL_PROJECT_CATEGORY.demolitionOnly;
  if (hasRenovation) return INFILL_PROJECT_CATEGORY.renovationOrAddition;
  if (signals.some((signal) => signal.residentialBuilding)) {
    return INFILL_PROJECT_CATEGORY.uncertainResidentialDevelopment;
  }
  return INFILL_PROJECT_CATEGORY.notRelevant;
}

export function classifyInfillProject(
  input: InfillClassificationInput,
  config: InfillScoringConfig = DEFAULT_INFILL_SCORING_CONFIG,
): InfillClassificationResult {
  const episode = selectLatestInfillEpisode(input.events, config);
  const signals = episode.events.map((event) => eventSignals(event, config));
  const allText = signals.map((signal) => signal.allText).join(" ");
  const commercialOrIndustrial =
    containsAny(allText, config.keywords.commercialOrIndustrial) ||
    (signals.length === 0 &&
      episode.allAssessments.some((assessment) => assessment.commercialOrIndustrial));
  const hasDemolitionAtSameAddress = signals.some(
    (signal) => signal.demolition && signal.event.sameAddress !== false,
  );
  const newResidentialConstruction = signals.some((signal) => signal.newResidentialConstruction);
  const developmentAndBuildingPermit = signals.some(
    (developmentSignal, developmentIndex) =>
      developmentSignal.developmentPermit &&
      developmentSignal.newResidentialConstruction &&
      signals.some(
        (buildingSignal, buildingIndex) =>
          buildingIndex !== developmentIndex &&
          buildingSignal.buildingPermit &&
          buildingSignal.newResidentialConstruction,
      ),
  );
  const newDwellingLanguage = signals.some((signal) => signal.newDwellingLanguage);
  const maximumUnits = maxNumeric([
    input.estimatedUnits,
    ...signals.map((signal) => signal.event.unitsAdded),
  ]);
  const recognizedResidentialBuildingType = signals.some((signal) => signal.residentialBuilding);
  const maximumConstructionValue = maxNumeric([
    input.estimatedConstructionValue,
    ...signals.map((signal) => signal.event.constructionValue),
  ]);
  const renovationOnly = signals.some((signal) => signal.renovation) && !newResidentialConstruction;
  const scoreExplanation: InfillScoreExplanation[] = [];
  const timeline = analyzeTimeline(signals, config.demolitionToConstructionWindowDays);
  const demolitionAtSameAddress =
    hasDemolitionAtSameAddress && (!newResidentialConstruction || timeline.withinConfiguredWindow);

  const addRule = (
    matched: boolean,
    rule: keyof InfillScoringConfig["weights"],
    message: string,
  ): void => {
    if (!matched) return;
    scoreExplanation.push({ rule, points: config.weights[rule], message });
  };

  addRule(
    demolitionAtSameAddress,
    "demolitionAtSameAddress",
    "A demolition event was found at the same site address.",
  );
  addRule(
    newResidentialConstruction,
    "newResidentialConstruction",
    "A new residential construction event was found.",
  );
  addRule(
    developmentAndBuildingPermit,
    "developmentAndBuildingPermit",
    "Both development and building permit events were found.",
  );
  addRule(
    newDwellingLanguage,
    "newDwellingLanguage",
    "The work description contains new-dwelling language.",
  );
  addRule(
    maximumUnits !== null && maximumUnits >= 2,
    "twoOrMoreUnits",
    `The project adds ${maximumUnits ?? 0} units.`,
  );
  addRule(
    recognizedResidentialBuildingType,
    "recognizedResidentialBuildingType",
    "A recognized residential building type was found.",
  );
  addRule(
    maximumConstructionValue !== null &&
      maximumConstructionValue > config.highConstructionValueThreshold,
    "constructionValueAboveThreshold",
    `Construction value exceeds the configured $${config.highConstructionValueThreshold.toLocaleString("en-CA")} threshold.`,
  );
  addRule(
    renovationOnly,
    "renovationOnly",
    "The available language describes only renovation, alteration, or addition work.",
  );

  if (commercialOrIndustrial) {
    scoreExplanation.splice(0, scoreExplanation.length, {
      rule: "commercialOrIndustrialExclusion",
      points: 0,
      message: "Commercial or industrial language excludes this project from residential infill.",
    });
  }

  const unboundedScore = scoreExplanation.reduce(
    (total, explanation) => total + explanation.points,
    0,
  );
  const confidenceScore = commercialOrIndustrial ? 0 : Math.max(0, Math.min(100, unboundedScore));
  const category = determineCategory(input, signals, config, commercialOrIndustrial);
  const reasons = scoreExplanation.map((explanation) => explanation.message).join(" ");
  const timelineSentence = timeline.withinConfiguredWindow
    ? ` Demolition preceded construction by ${timeline.demolitionToConstructionDays} days.`
    : "";
  const plainLanguageExplanation =
    `${INFILL_PROJECT_CATEGORY_LABELS[category]} with a confidence score of ${confidenceScore}/100. ${reasons}${timelineSentence}`.trim();

  return {
    category,
    confidenceScore,
    scoreExplanation,
    plainLanguageExplanation,
    timeline,
    episode,
  };
}

export function calculateInfillConfidenceScore(
  input: InfillClassificationInput,
  config: InfillScoringConfig = DEFAULT_INFILL_SCORING_CONFIG,
): number {
  return classifyInfillProject(input, config).confidenceScore;
}
