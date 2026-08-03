import type { Metadata } from "next";
import { Gauge, Scale } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeading } from "@/components/workspace/page-header";
import { configuredInfillScoringConfig } from "@/src/domain/infill-scoring-config";
import { requireAdmin } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import { previewProjectScoring } from "@/src/services/project-intelligence";
import { PROJECT_CATEGORY_LABELS, PROJECT_STAGE_LABELS } from "@/src/services/project-read-model";

export const metadata: Metadata = { title: "Scoring rules" };
export const dynamic = "force-dynamic";

const weightLabels: Record<string, string> = {
  demolitionAtSameAddress: "Demolition at the same address",
  newResidentialConstruction: "New residential construction",
  developmentAndBuildingPermit: "Development and building permits",
  newDwellingLanguage: "New-dwelling language",
  twoOrMoreUnits: "Two or more units",
  recognizedResidentialBuildingType: "Recognized residential building type",
  constructionValueAboveThreshold: "Construction value above threshold",
  renovationOnly: "Renovation-only evidence",
  outsideCoreInfillArea: "Outside the core infill area",
};

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ projectId?: string }>;
}) {
  const user = await requireAdmin("/admin/rules");
  const db = await getDb();
  const projects = await db.project.findMany({
    where: { mergedIntoId: null },
    orderBy: [
      { reviewStatus: "asc" },
      { infillConfidence: "asc" },
      { latestInfillActivityDate: { sort: "desc", nulls: "last" } },
    ],
    take: 100,
    select: {
      id: true,
      address: { select: { normalizedStreetAddress: true } },
      category: true,
      currentStage: true,
    },
  });
  const requested = (await searchParams).projectId;
  const selected = projects.find((project) => project.id === requested);
  const preview = selected
    ? await previewProjectScoring(db, { projectId: selected.id, actorUserId: user.id })
    : null;
  const config = configuredInfillScoringConfig();

  return (
    <section>
      <PageHeading
        eyebrow="Explainable classification"
        title="Scoring rules"
        description="Review the current evidence weights and preview how the active code classifies a project. This page makes no writes; changing global policy still requires a reviewed code/config update."
      />
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <section className="rounded-xl border border-[var(--border)] bg-white p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-[var(--teal-soft)] text-[var(--teal)]">
              <Scale size={18} />
            </div>
            <div>
              <div className="eyebrow">Active configuration</div>
              <h2 className="mt-1 mb-0 text-lg font-bold text-[var(--spruce)]">Evidence weights</h2>
            </div>
          </div>
          <div className="divide-y divide-[var(--border)]">
            {Object.entries(config.weights).map(([rule, points]) => (
              <div key={rule} className="flex items-center justify-between gap-3 py-3 text-xs">
                <span>{weightLabels[rule] ?? rule}</span>
                <Badge tone={points >= 0 ? "green" : "red"}>
                  {points > 0 ? "+" : ""}
                  {points}
                </Badge>
              </div>
            ))}
          </div>
          <dl className="mt-4 grid gap-3 rounded-lg bg-[#f7f8f5] p-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-[var(--muted)]">High-value threshold</dt>
              <dd className="m-0 mt-1 font-bold">
                ${config.highConstructionValueThreshold.toLocaleString("en-CA")}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Demolition window</dt>
              <dd className="m-0 mt-1 font-bold">
                {config.demolitionToConstructionWindowDays} days
              </dd>
            </div>
            <div>
              <dt className="text-[var(--muted)]">Maximum episode lookback</dt>
              <dd className="m-0 mt-1 font-bold">{config.maxEpisodeGapDays} days</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-white p-5">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-[#fff1df] text-[var(--copper)]">
              <Gauge size={18} />
            </div>
            <div>
              <div className="eyebrow">Read-only calculation</div>
              <h2 className="mt-1 mb-0 text-lg font-bold text-[var(--spruce)]">
                Project scoring preview
              </h2>
            </div>
          </div>
          <form method="get" action="/admin/rules">
            <label className="text-xs font-semibold">
              Project
              <select
                name="projectId"
                defaultValue={selected?.id ?? ""}
                className="mt-1 min-h-11 w-full rounded-lg border border-[var(--border)] bg-white px-3 text-sm"
                required
              >
                <option value="" disabled>
                  Select a project
                </option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.address.normalizedStreetAddress}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="submit"
              className="mt-3 inline-flex min-h-10 items-center rounded-lg bg-[var(--spruce)] px-4 text-sm font-semibold text-white"
            >
              Preview current scoring
            </button>
          </form>
          {preview ? (
            <div className="mt-5">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-[#f7f8f5] p-3">
                  <span className="text-xs text-[var(--muted)]">Computed category</span>
                  <strong className="mt-1 block text-sm text-[var(--spruce)]">
                    {PROJECT_CATEGORY_LABELS[preview.computedCategory]}
                  </strong>
                </div>
                <div className="rounded-lg bg-[#f7f8f5] p-3">
                  <span className="text-xs text-[var(--muted)]">Computed stage</span>
                  <strong className="mt-1 block text-sm text-[var(--spruce)]">
                    {PROJECT_STAGE_LABELS[preview.computedStage]}
                  </strong>
                </div>
                <div className="rounded-lg bg-[#f7f8f5] p-3">
                  <span className="text-xs text-[var(--muted)]">Core-area status</span>
                  <strong className="mt-1 block text-sm text-[var(--spruce)]">
                    {preview.infillAreaClassification.replaceAll("_", " ").toLowerCase()}
                  </strong>
                </div>
              </div>
              <div className="mt-4 flex items-end justify-between gap-4">
                <div>
                  <span className="text-xs text-[var(--muted)]">Confidence score</span>
                  <strong className="mt-1 block text-3xl text-[var(--spruce)]">
                    {preview.confidenceScore}%
                  </strong>
                </div>
                {selected && (
                  <div className="text-right text-xs text-[var(--muted)]">
                    Currently applied
                    <br />
                    <strong className="text-[var(--ink)]">
                      {PROJECT_CATEGORY_LABELS[selected.category]} ·{" "}
                      {PROJECT_STAGE_LABELS[selected.currentStage]}
                    </strong>
                  </div>
                )}
              </div>
              <ul className="m-0 mt-4 space-y-2 p-0">
                {preview.confidenceExplanation.factors.map((factor) => (
                  <li
                    key={`${factor.rule}-${factor.points}`}
                    className="flex justify-between gap-3 rounded-lg border border-[var(--border)] p-3 text-xs"
                  >
                    <span>{factor.message}</span>
                    <Badge tone={factor.points >= 0 ? "green" : "red"}>
                      {factor.points > 0 ? "+" : ""}
                      {factor.points}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-5 text-sm text-[var(--muted)]">
              Select a project to compare computed and currently applied values.
            </p>
          )}
        </section>
      </div>
    </section>
  );
}
