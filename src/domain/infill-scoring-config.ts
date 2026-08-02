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
}

export interface InfillScoringConfig {
  weights: InfillScoringWeights;
  keywords: InfillScoringKeywords;
  highConstructionValueThreshold: number;
  demolitionToConstructionWindowDays: number;
}

export type InfillScoringConfigOverrides = Omit<
  Partial<InfillScoringConfig>,
  "weights" | "keywords"
> & {
  weights?: Partial<InfillScoringWeights>;
  keywords?: Partial<InfillScoringKeywords>;
};

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
  demolitionToConstructionWindowDays: 730,
  keywords: {
    demolition: ["demolition", "demolish", "remove existing dwelling", "remove existing house"],
    newConstruction: ["new building", "new construction", "construct", "construction of", "erect"],
    newDwelling: [
      "new dwelling",
      "new detached",
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
      "backyard housing",
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
    gardenSuite: ["garden suite", "backyard housing"],
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
