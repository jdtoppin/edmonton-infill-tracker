import Link from "next/link";
import {
  Building2,
  CalendarCheck,
  CircleCheck,
  ExternalLink,
  FileText,
  Hammer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { OccupancyEstimate } from "@/components/projects/occupancy-estimate";
import {
  formatConstructionValue,
  type ProjectTimelineEntry,
} from "@/src/services/project-read-model";

function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function TimelineIcon({ type }: { type: ProjectTimelineEntry["milestoneType"] }) {
  const Icon =
    type === "OCCUPANCY"
      ? CircleCheck
      : type === "BUILDING_PERMIT"
        ? Building2
        : type === "DEVELOPMENT_PERMIT"
          ? CalendarCheck
          : type === "DEMOLITION"
            ? Hammer
            : FileText;
  return <Icon size={17} aria-hidden="true" />;
}

export function ProjectTimeline({
  projectId,
  timeline,
  showRaw,
}: {
  projectId: string;
  timeline: ProjectTimelineEntry[];
  showRaw: boolean;
}) {
  if (timeline.length === 0) {
    return (
      <p className="rounded-lg bg-[#f7f8f5] p-4 text-sm text-[var(--muted)]">
        No normalized permit milestones are available for this project yet.
      </p>
    );
  }
  return (
    <ol className="relative m-0 list-none p-0 before:absolute before:top-5 before:bottom-5 before:left-[21px] before:w-px before:bg-[var(--border)]">
      {timeline.map((entry) => {
        const trackerObservation = entry.milestoneType === "OBSERVED";
        return (
          <li
            key={entry.key}
            className="relative grid grid-cols-[44px_minmax(0,1fr)] gap-4 pb-5 last:pb-0"
          >
            <div
              className={`relative z-10 grid size-11 place-items-center rounded-full border-4 border-white ${entry.milestoneType === "OCCUPANCY" ? "bg-[#eaf6f0] text-[var(--positive)]" : "bg-[var(--teal-soft)] text-[var(--teal)]"}`}
            >
              <TimelineIcon type={entry.milestoneType} />
            </div>
            <article className="rounded-xl border border-[var(--border)] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="eyebrow">
                    {trackerObservation ? "Tracker observation · " : ""}
                    {dateLabel(entry.date)}
                  </div>
                  <h3 className="mt-1 mb-0 text-base font-bold text-[var(--spruce)]">
                    {trackerObservation ? "Undated City record" : entry.stageLabel}
                  </h3>
                </div>
                {entry.status && (
                  <Badge tone={entry.milestoneType === "OCCUPANCY" ? "green" : "neutral"}>
                    {entry.status}
                  </Badge>
                )}
              </div>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-[var(--muted)]">
                    {trackerObservation ? "City reference" : "Permit"}
                  </dt>
                  <dd className="m-0 mt-1 font-semibold">
                    {entry.permitNumber ?? "Number not reported"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Type</dt>
                  <dd className="m-0 mt-1 font-semibold">
                    {entry.permitSubtype ?? entry.permitType}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Construction value</dt>
                  <dd className="m-0 mt-1 font-semibold">
                    {formatConstructionValue(entry.constructionValue)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--muted)]">Units recorded</dt>
                  <dd className="m-0 mt-1 font-semibold">{entry.units ?? "Not reported"}</dd>
                </div>
              </dl>
              {entry.description && (
                <p className="mt-4 mb-0 text-sm leading-6 text-[var(--muted)]">
                  {entry.description}
                </p>
              )}
              {trackerObservation && (
                <p className="mt-4 mb-0 rounded-lg bg-[#f7f8f5] px-3 py-2 text-xs leading-5 text-[var(--muted)]">
                  Infill Tracker first imported this City row on {dateLabel(entry.date)}. The source
                  does not provide an application, issue, or occupancy date, so this is not a permit
                  milestone.
                </p>
              )}
              {entry.occupancyEstimate && <OccupancyEstimate estimate={entry.occupancyEstimate} />}
              <div className="mt-4 flex flex-wrap gap-3 text-xs font-semibold">
                {entry.source.datasetUrl && (
                  <a
                    href={entry.source.datasetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center gap-1 text-[var(--teal)]"
                  >
                    Open City dataset <ExternalLink size={13} />
                  </a>
                )}
                {entry.source.recordUrl && (
                  <a
                    href={entry.source.recordUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-9 items-center gap-1 text-[var(--teal)]"
                  >
                    Open source record <ExternalLink size={13} />
                  </a>
                )}
                {showRaw && (
                  <Link
                    href={`/admin/projects/${encodeURIComponent(projectId)}/events/${encodeURIComponent(entry.permitEventId)}/raw`}
                    className="inline-flex min-h-9 items-center text-[var(--copper)]"
                  >
                    View stored raw record
                  </Link>
                )}
              </div>
            </article>
          </li>
        );
      })}
    </ol>
  );
}
