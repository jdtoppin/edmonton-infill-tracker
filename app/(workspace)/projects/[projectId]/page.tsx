import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Building2, CircleCheck, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import { ProjectReviewActions } from "@/components/admin/project-review-actions";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ProjectMap, type ProjectMapMarker } from "@/components/projects/project-map";
import { ProjectTimeline } from "@/components/projects/project-timeline";
import { PreviewBanner } from "@/components/workspace/data-state";
import { WorkspaceTopbar } from "@/components/workspace/page-header";
import { ProjectCategory, ProjectStage } from "@/src/generated/prisma/enums";
import { getCurrentUser, requireUser } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import {
  formatConstructionValue,
  getPreviewProjectDetail,
  getProjectDetail,
  PROJECT_CATEGORY_LABELS,
  PROJECT_STAGE_LABELS,
  projectCategoryTone,
} from "@/src/services/project-read-model";

export const metadata: Metadata = { title: "Project timeline" };
export const dynamic = "force-dynamic";

function dateLabel(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "short", day: "numeric" }).format(
        new Date(`${value}T12:00:00`),
      )
    : "Not recorded";
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const preview = !process.env.DATABASE_URL && process.env.AUTH_REQUIRED !== "true";
  const user = preview
    ? Promise.resolve(null)
    : process.env.AUTH_REQUIRED === "true"
      ? requireUser(`/projects/${encodeURIComponent(projectId)}`)
      : getCurrentUser();
  const authorizedUser = await user;
  const project = preview
    ? getPreviewProjectDetail(projectId)
    : await getProjectDetail(await getDb(), projectId);
  if (!project) notFound();
  const isAdmin = authorizedUser?.role === "ADMIN";
  const marker: ProjectMapMarker = {
    id: project.id,
    address: project.address,
    neighbourhood: project.neighbourhood.name,
    categoryLabel: project.categoryLabel,
    stageLabel: project.stageLabel,
    confidence: project.confidence,
    latestInfillActivityDate: project.latestInfillActivityDate,
    constructionValue:
      project.constructionValue === null
        ? null
        : formatConstructionValue(project.constructionValue),
    estimatedUnits: project.units,
    latitude: project.latitude,
    longitude: project.longitude,
  };

  return (
    <>
      <WorkspaceTopbar
        status={
          <Badge tone={project.confidence >= 80 ? "green" : "copper"}>
            {project.confidence}% confidence
          </Badge>
        }
      />
      <main className="content">
        {preview && <PreviewBanner />}
        <Link
          href="/projects"
          className="mb-5 inline-flex min-h-10 items-center gap-2 text-xs font-semibold text-[var(--teal)] no-underline"
        >
          <ArrowLeft size={15} /> Back to projects
        </Link>
        <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="page-kicker">
              <MapPin size={13} /> {project.neighbourhood.name}
            </div>
            <h1 className="mt-2 mb-0 text-4xl font-bold tracking-[-0.045em] text-[var(--spruce)]">
              {project.address}
            </h1>
            <div className="mt-4 flex flex-wrap gap-2">
              <Badge tone={projectCategoryTone(project.category)}>{project.categoryLabel}</Badge>
              <Badge>{project.stageLabel}</Badge>
              <Badge tone={project.reviewStatus === "CONFIRMED" ? "green" : "neutral"}>
                {project.reviewStatusLabel}
              </Badge>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[560px]">
            {[
              { label: "Infill start", value: dateLabel(project.infillStartDate) },
              {
                label: "Latest infill milestone",
                value: dateLabel(project.latestInfillActivityDate),
              },
              { label: "Est. units", value: project.units ?? "—" },
              { label: "Est. value", value: formatConstructionValue(project.constructionValue) },
            ].map((fact) => (
              <div
                key={fact.label}
                className="rounded-xl border border-[var(--border)] bg-white p-3"
              >
                <span className="block text-[11px] text-[var(--muted)]">{fact.label}</span>
                <strong className="mt-1 block text-sm text-[var(--spruce)]">{fact.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.8fr)]">
          <Card className="p-5">
            <div className="section-head">
              <div>
                <div className="eyebrow">Evidence trail</div>
                <h2>Project evidence history</h2>
              </div>
              <Building2 size={18} className="text-[var(--teal)]" />
            </div>
            <ProjectTimeline projectId={project.id} timeline={project.timeline} showRaw={isAdmin} />
          </Card>
          <div className="space-y-4">
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--teal-soft)] text-[var(--teal)]">
                  <Sparkles size={20} />
                </div>
                <div>
                  <div className="eyebrow">Why this project</div>
                  <h2 className="mt-1 mb-0 text-xl font-bold text-[var(--spruce)]">
                    {project.confidence}% confidence
                  </h2>
                </div>
              </div>
              <p className="mt-4 text-sm leading-6 text-[var(--muted)]">
                {project.confidenceExplanation.summary}
              </p>
              {project.confidenceExplanation.factors.length > 0 && (
                <ul className="m-0 mt-4 space-y-2 p-0">
                  {project.confidenceExplanation.factors.map((factor) => (
                    <li
                      key={`${factor.rule}-${factor.points}`}
                      className="flex items-start justify-between gap-3 rounded-lg bg-[#f7f8f5] px-3 py-2 text-xs"
                    >
                      <span>{factor.message ?? factor.rule}</span>
                      <Badge tone={factor.points >= 0 ? "green" : "red"}>
                        {factor.points > 0 ? "+" : ""}
                        {factor.points}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-5">
              <div className="section-head">
                <div>
                  <div className="eyebrow">Location</div>
                  <h2>Project map</h2>
                </div>
              </div>
              <ProjectMap
                markers={[marker]}
                mapStyleUrl={process.env.MAP_STYLE_URL}
                mapTileUrl={process.env.MAP_TILE_URL}
                initialSelectedId={project.id}
                showList={false}
                className="min-h-[390px]"
              />
            </Card>
            <Card className="p-5">
              <div className="flex items-start gap-3">
                <CircleCheck className="mt-0.5 text-[var(--positive)]" size={19} />
                <div>
                  <strong className="block text-sm text-[var(--spruce)]">
                    Occupancy cross-check
                  </strong>
                  <p className="mt-1 mb-0 text-xs leading-5 text-[var(--muted)]">
                    {project.marketReviewRequired
                      ? "A City occupancy milestone was recorded after the last market comparison. This project is flagged for follow-up."
                      : "No new occupancy-triggered market comparison is waiting."}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {isAdmin && (
          <div className="mt-4">
            <ProjectReviewActions
              projectId={project.id}
              expectedUpdatedAt={project.updatedAt}
              categories={Object.values(ProjectCategory)
                .filter((value) => value !== ProjectCategory.NOT_RELEVANT)
                .map((value) => ({
                  value,
                  label: PROJECT_CATEGORY_LABELS[value],
                }))}
              stages={Object.values(ProjectStage).map((value) => ({
                value,
                label: PROJECT_STAGE_LABELS[value],
              }))}
              eventIds={project.timeline
                .map((event) => ({
                  value: event.permitEventId,
                  label: `${event.permitNumber ?? event.permitEventId} · ${event.permitSubtype ?? event.permitType}`,
                }))
                .filter(
                  (event, index, all) =>
                    all.findIndex((candidate) => candidate.value === event.value) === index,
                )}
            />
          </div>
        )}
        {isAdmin && (
          <p className="mt-3 flex items-center gap-2 text-xs text-[var(--muted)]">
            <ShieldCheck size={14} /> Corrections are administrator-only and recorded with your
            account.
          </p>
        )}
      </main>
    </>
  );
}
