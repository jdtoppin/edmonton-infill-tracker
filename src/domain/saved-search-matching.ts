export interface SavedSearchCriteria {
  active?: boolean;
  isActive?: boolean;
  selectedNeighbourhoods?: readonly (string | number)[];
  neighbourhoodIds?: readonly (string | number)[];
  projectCategories?: readonly string[];
  minimumConstructionValue?: number | null;
  minConstructionValue?: number | null;
  maximumConstructionValue?: number | null;
  maxConstructionValue?: number | null;
  minimumUnits?: number | null;
  minUnits?: number | null;
  maximumUnits?: number | null;
  maxUnits?: number | null;
  minimumConfidenceScore?: number | null;
  minConfidenceScore?: number | null;
  stages?: readonly string[];
  permitAndProjectStages?: readonly string[];
  projectStages?: readonly string[];
  permitStatuses?: readonly string[];
}

export interface SavedSearchProject {
  neighbourhoodId?: string | number | null;
  neighbourhoodName?: string | null;
  category?: string | null;
  projectCategory?: string | null;
  constructionValue?: number | null;
  estimatedConstructionValue?: number | null;
  units?: number | null;
  estimatedUnits?: number | null;
  confidenceScore?: number | null;
  infillConfidenceScore?: number | null;
  infillConfidence?: number | null;
  stage?: string | null;
  currentStage?: string | null;
  permitStatus?: string | null;
  latestPermitStatus?: string | null;
}

export type SavedSearchMismatchCode =
  | "inactive"
  | "neighbourhood"
  | "category"
  | "construction-value"
  | "units"
  | "confidence-score"
  | "stage"
  | "permit-status";

export interface SavedSearchMatchEvaluation {
  matches: boolean;
  mismatches: SavedSearchMismatchCode[];
}

function canonical(value: string | number): string {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function inSelection(
  valueCandidates: Array<string | number | null | undefined>,
  selection: readonly (string | number)[] | undefined,
): boolean {
  if (!selection || selection.length === 0) return true;
  const selected = new Set(selection.map(canonical));
  return valueCandidates.some(
    (value) => value !== null && value !== undefined && selected.has(canonical(value)),
  );
}

function inRange(
  value: number | null | undefined,
  minimum: number | null | undefined,
  maximum: number | null | undefined,
): boolean {
  const hasMinimum = typeof minimum === "number";
  const hasMaximum = typeof maximum === "number";
  if (!hasMinimum && !hasMaximum) return true;
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (hasMinimum && value < minimum) return false;
  if (hasMaximum && value > maximum) return false;
  return true;
}

/** Applies every configured saved-search filter using inclusive numeric bounds. */
export function evaluateSavedSearchMatch(
  search: SavedSearchCriteria,
  project: SavedSearchProject,
): SavedSearchMatchEvaluation {
  const mismatches: SavedSearchMismatchCode[] = [];
  if ((search.active ?? search.isActive) === false) mismatches.push("inactive");

  const neighbourhoods = search.selectedNeighbourhoods ?? search.neighbourhoodIds;
  if (!inSelection([project.neighbourhoodId, project.neighbourhoodName], neighbourhoods)) {
    mismatches.push("neighbourhood");
  }

  const category = project.category ?? project.projectCategory;
  if (!inSelection([category], search.projectCategories)) {
    mismatches.push("category");
  }

  const constructionValue = project.constructionValue ?? project.estimatedConstructionValue;
  if (
    !inRange(
      constructionValue,
      search.minimumConstructionValue ?? search.minConstructionValue,
      search.maximumConstructionValue ?? search.maxConstructionValue,
    )
  ) {
    mismatches.push("construction-value");
  }

  const units = project.units ?? project.estimatedUnits;
  if (
    !inRange(units, search.minimumUnits ?? search.minUnits, search.maximumUnits ?? search.maxUnits)
  ) {
    mismatches.push("units");
  }

  const confidenceScore =
    project.confidenceScore ?? project.infillConfidenceScore ?? project.infillConfidence;
  if (
    !inRange(confidenceScore, search.minimumConfidenceScore ?? search.minConfidenceScore, undefined)
  ) {
    mismatches.push("confidence-score");
  }

  const stages = search.stages ?? search.permitAndProjectStages ?? search.projectStages;
  const stage = project.stage ?? project.currentStage;
  if (!inSelection([stage], stages)) mismatches.push("stage");

  const permitStatus = project.permitStatus ?? project.latestPermitStatus;
  if (!inSelection([permitStatus], search.permitStatuses)) {
    mismatches.push("permit-status");
  }

  return { matches: mismatches.length === 0, mismatches };
}

export function matchesSavedSearch(
  search: SavedSearchCriteria,
  project: SavedSearchProject,
): boolean {
  return evaluateSavedSearchMatch(search, project).matches;
}
