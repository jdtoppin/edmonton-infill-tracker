export interface InfillScoringWeights {
  demolitionAtSameAddress: number;
  newResidentialConstruction: number;
  developmentAndBuildingPermit: number;
  newDwellingLanguage: number;
  twoOrMoreUnits: number;
  recognizedResidentialBuildingType: number;
  constructionValueAboveThreshold: number;
  renovationOnly: number;
}

export interface InfillScoringKeywords {
  demolition: readonly string[];
  newConstruction: readonly string[];
  newDwelling: readonly string[];
  developmentPermit: readonly string[];
  buildingPermit: readonly string[];
  residentialBuilding: readonly string[];
  renovation: readonly string[];
  commercialOrIndustrial: readonly string[];
  detached: readonly string[];
  semiDetached: readonly string[];
  duplex: readonly string[];
  rowHousing: readonly string[];
  gardenSuite: readonly string[];
  propertyOnly: readonly string[];
  inactiveStatus: readonly string[];
}

export interface InfillScoringConfig {
  weights: InfillScoringWeights;
  keywords: InfillScoringKeywords;
  highConstructionValueThreshold: number;
  demolitionToConstructionWindowDays: number;
  maxEpisodeGapDays: number;
}

export type InfillScoringConfigOverrides = Omit<
  Partial<InfillScoringConfig>,
  "weights" | "keywords"
> & {
  weights?: Partial<InfillScoringWeights>;
  keywords?: Partial<InfillScoringKeywords>;
};

export class InfillScoringConfigError extends Error {}

/**
 * Initial MVP scoring policy. Keeping weights, thresholds, and language here
 * lets operators tune the classifier without changing its decision engine.
 */
export const DEFAULT_INFILL_SCORING_CONFIG: Readonly<InfillScoringConfig> = {
  weights: {
    demolitionAtSameAddress: 20,
    newResidentialConstruction: 30,
    developmentAndBuildingPermit: 15,
    newDwellingLanguage: 10,
    twoOrMoreUnits: 10,
    recognizedResidentialBuildingType: 10,
    constructionValueAboveThreshold: 5,
    renovationOnly: -25,
  },
  highConstructionValueThreshold: 250_000,
  demolitionToConstructionWindowDays: 548,
  maxEpisodeGapDays: 548,
  keywords: {
    demolition: ["demolition", "demolish", "remove existing dwelling", "remove existing house"],
    newConstruction: ["new building", "new construction", "construct", "construction of", "erect"],
    newDwelling: [
      "new dwelling",
      "new house",
      "construct a dwelling",
      "construct dwelling",
      "construction of a dwelling",
    ],
    developmentPermit: ["development permit", "development application"],
    buildingPermit: ["building permit"],
    residentialBuilding: [
      "residential",
      "dwelling",
      "single detached",
      "detached house",
      "semi-detached",
      "semi detached",
      "duplex",
      "row house",
      "row housing",
      "townhouse",
      "town house",
      "garden suite",
      "garage suite",
      "backyard house",
      "backyard housing",
      "cluster housing",
      "multi-unit",
      "multi unit",
    ],
    renovation: [
      "addition",
      "alteration",
      "interior renovation",
      "renovation",
      "renovate",
      "repair",
    ],
    commercialOrIndustrial: [
      "commercial",
      "industrial",
      "office building",
      "restaurant",
      "retail",
      "warehouse",
    ],
    detached: ["single detached", "detached dwelling", "detached house", "new detached"],
    semiDetached: ["semi-detached", "semi detached"],
    duplex: ["duplex"],
    rowHousing: ["row house", "row housing", "row dwelling", "townhouse", "town house"],
    gardenSuite: ["garden suite", "garage suite", "backyard house", "backyard housing"],
    propertyOnly: [
      "accessory building",
      "accessory structure",
      "detached garage",
      "mutual garage",
      "garage",
      "carport",
      "shed",
      "deck",
      "fence",
      "driveway",
      "air conditioner",
      "air conditioning",
      "hvac",
      "heating and ventilation",
      "solar panel",
      "hot tub",
      "swimming pool",
    ],
    inactiveStatus: ["cancelled", "canceled", "expired", "refused", "withdrawn", "void", "voided"],
  },
};

export function createInfillScoringConfig(
  overrides: InfillScoringConfigOverrides = {},
): InfillScoringConfig {
  return {
    ...DEFAULT_INFILL_SCORING_CONFIG,
    ...overrides,
    weights: {
      ...DEFAULT_INFILL_SCORING_CONFIG.weights,
      ...overrides.weights,
    },
    keywords: {
      ...DEFAULT_INFILL_SCORING_CONFIG.keywords,
      ...overrides.keywords,
    },
  };
}

export function configuredInfillScoringConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): InfillScoringConfig {
  const configuredThreshold = environment.INFILL_HIGH_VALUE_THRESHOLD?.trim();
  const highConstructionValueThreshold = configuredThreshold
    ? Number(configuredThreshold)
    : undefined;
  if (
    highConstructionValueThreshold !== undefined &&
    (!Number.isFinite(highConstructionValueThreshold) || highConstructionValueThreshold < 0)
  ) {
    throw new InfillScoringConfigError(
      "INFILL_HIGH_VALUE_THRESHOLD must be a non-negative number.",
    );
  }

  const configuredEpisodeGap = environment.INFILL_EPISODE_GAP_DAYS?.trim();
  const maxEpisodeGapDays = configuredEpisodeGap ? Number(configuredEpisodeGap) : undefined;
  if (
    maxEpisodeGapDays !== undefined &&
    (!Number.isInteger(maxEpisodeGapDays) || maxEpisodeGapDays < 1 || maxEpisodeGapDays > 3_650)
  ) {
    throw new InfillScoringConfigError(
      "INFILL_EPISODE_GAP_DAYS must be an integer from 1 through 3650.",
    );
  }

  return createInfillScoringConfig({
    ...(highConstructionValueThreshold === undefined ? {} : { highConstructionValueThreshold }),
    ...(maxEpisodeGapDays === undefined
      ? {}
      : {
          maxEpisodeGapDays,
          demolitionToConstructionWindowDays: maxEpisodeGapDays,
        }),
  });
}
