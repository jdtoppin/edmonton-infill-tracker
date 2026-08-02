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
  permitType?: string | null;
  permitSubtype?: string | null;
  workDescription?: string | null;
  buildingType?: string | null;
  unitsAdded?: number | null;
  constructionValue?: number | null;
  applicationDate?: string | Date | null;
  issueDate?: string | Date | null;
  eventDate?: string | Date | null;
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

function getEventTime(event: InfillPermitEvent): number | null {
  const value = event.eventDate ?? event.issueDate ?? event.applicationDate;
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function eventSignals(event: InfillPermitEvent, config: InfillScoringConfig): EventSignals {
  const descriptionText = searchable(event.workDescription);
  const permitText = searchable(event.permitType, event.permitSubtype);
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
  const categorySpecificConstruction = containsAny(allText, [
    ...config.keywords.detached,
    ...config.keywords.semiDetached,
    ...config.keywords.duplex,
    ...config.keywords.rowHousing,
    ...config.keywords.gardenSuite,
  ]);
  const newConstructionIndicator =
    /\bnew\b/.test(allText) || containsAny(allText, config.keywords.newConstruction);
  const configuredNewDwelling = containsAny(descriptionText, config.keywords.newDwelling);
  const flexibleNewDwelling = /\bnew\b.{0,50}\b(?:dwelling|house|residential)\b/.test(
    descriptionText,
  );
  const newDwellingLanguage = configuredNewDwelling || flexibleNewDwelling;
  const explicitResidentialConstruction =
    newDwellingLanguage || (categorySpecificConstruction && newConstructionIndicator);
  const newResidentialConstruction =
    explicitResidentialConstruction ||
    (newConstructionIndicator && residentialBuilding && !renovation);

  return {
    event,
    allText,
    descriptionText,
    permitText,
    demolition: containsAny(allText, config.keywords.demolition),
    developmentPermit:
      containsAny(permitText, config.keywords.developmentPermit) ||
      /\bdevelopment\b/.test(permitText),
    buildingPermit:
      containsAny(permitText, config.keywords.buildingPermit) || /\bbuilding\b/.test(permitText),
    residentialBuilding,
    renovation,
    newDwellingLanguage,
    newResidentialConstruction,
    eventTime: getEventTime(event),
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

  const allText = signals.map((signal) => signal.allText).join(" ");
  const hasNewConstruction = signals.some((signal) => signal.newResidentialConstruction);
  const hasDemolition = signals.some(
    (signal) => signal.demolition && signal.event.sameAddress !== false,
  );
  const hasRenovation = signals.some((signal) => signal.renovation);

  if (hasNewConstruction) {
    if (containsAny(allText, config.keywords.gardenSuite)) {
      return INFILL_PROJECT_CATEGORY.probableGardenSuite;
    }
    if (containsAny(allText, config.keywords.rowHousing)) {
      return INFILL_PROJECT_CATEGORY.probableRowHousing;
    }
    if (containsAny(allText, config.keywords.semiDetached)) {
      return INFILL_PROJECT_CATEGORY.probableSemiDetachedInfill;
    }
    if (containsAny(allText, config.keywords.duplex)) {
      return INFILL_PROJECT_CATEGORY.probableDuplex;
    }
    if (containsAny(allText, config.keywords.detached)) {
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
  const signals = input.events.map((event) => eventSignals(event, config));
  const allText = signals.map((signal) => signal.allText).join(" ");
  const commercialOrIndustrial = containsAny(allText, config.keywords.commercialOrIndustrial);
  const demolitionAtSameAddress = signals.some(
    (signal) => signal.demolition && signal.event.sameAddress !== false,
  );
  const newResidentialConstruction = signals.some((signal) => signal.newResidentialConstruction);
  const developmentAndBuildingPermit = signals.some(
    (developmentSignal, developmentIndex) =>
      developmentSignal.developmentPermit &&
      signals.some(
        (buildingSignal, buildingIndex) =>
          buildingIndex !== developmentIndex && buildingSignal.buildingPermit,
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
  const timeline = analyzeTimeline(signals, config.demolitionToConstructionWindowDays);
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
  };
}

export function calculateInfillConfidenceScore(
  input: InfillClassificationInput,
  config: InfillScoringConfig = DEFAULT_INFILL_SCORING_CONFIG,
): number {
  return classifyInfillProject(input, config).confidenceScore;
}
