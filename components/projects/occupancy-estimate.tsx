import type { OccupancyTimingEstimate } from "@/src/domain/occupancy-estimate";

const AVERAGE_DAYS_PER_MONTH = 365.25 / 12;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00.000Z`));
}

function formatDuration(days: number): string {
  if (days < 1) return "less than one day";

  const months = Math.max(1, Math.round(days / AVERAGE_DAYS_PER_MONTH));
  if (months < 12) return `${months} ${months === 1 ? "month" : "months"}`;

  const years = Math.floor(months / 12);
  const remainingMonths = months % 12;
  const yearLabel = `${years} ${years === 1 ? "year" : "years"}`;
  return remainingMonths === 0
    ? yearLabel
    : `${yearLabel}, ${remainingMonths} ${remainingMonths === 1 ? "month" : "months"}`;
}

function clampedPercent(days: number, maximumDays: number): number {
  if (!Number.isFinite(days) || !Number.isFinite(maximumDays) || maximumDays <= 0) return 0;
  return Math.min(100, Math.max(0, (days / maximumDays) * 100));
}

function estimateStatus(estimate: OccupancyTimingEstimate): {
  label: string;
  detail: string;
  tone: string;
} {
  if (estimate.elapsedDays > estimate.maxComparisonDays) {
    return {
      label: "Beyond the two-year comparison range",
      detail: `${formatDuration(estimate.elapsedDays)} have elapsed since this building permit was issued.`,
      tone: "border-[#e7c1bc] bg-[#faecea] text-[#963c34]",
    };
  }

  if (estimate.daysBeyondTypical > 0) {
    return {
      label: "Longer than the typical timeframe",
      detail: `The typical point passed about ${formatDuration(estimate.daysBeyondTypical)} ago; no occupancy date is reported yet.`,
      tone: "border-[#edd0b0] bg-[#fff3e7] text-[#8e501a]",
    };
  }

  return {
    label: "Within the typical timeframe",
    detail: `The typical point is about ${formatDuration(estimate.daysRemaining)} away.`,
    tone: "border-[#b9dccb] bg-[#eaf6f0] text-[#28654c]",
  };
}

export function OccupancyEstimate({ estimate }: { estimate: OccupancyTimingEstimate }) {
  const status = estimateStatus(estimate);
  const nowPosition = clampedPercent(estimate.elapsedDays, estimate.maxComparisonDays);
  const typicalPosition = clampedPercent(estimate.typicalDays, estimate.maxComparisonDays);
  const historical = estimate.basis === "HISTORICAL_KAPLAN_MEIER";
  const scopeLabel = estimate.scope === "CATEGORY" ? "same-category" : "tracked infill";
  const typicalDuration = formatDuration(estimate.typicalDays);
  const elapsedDuration = formatDuration(estimate.elapsedDays);
  const accessibleSummary = [
    `Building permit issued ${formatDate(estimate.issueDate)}.`,
    `No occupancy date has been reported as of ${formatDate(estimate.asOfDate)}.`,
    `${elapsedDuration} elapsed.`,
    `Typical timing is ${typicalDuration}.`,
    `The comparison scale ends at ${formatDuration(estimate.maxComparisonDays)}.`,
  ].join(" ");

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[#f7f8f5] p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="eyebrow">Building permit follow-through</div>
          <h4 className="mt-1 mb-0 text-base font-bold text-[var(--spruce)]">
            Typical occupancy timing
          </h4>
        </div>
        <div className={`w-fit rounded-lg border px-3 py-2 text-xs ${status.tone}`}>
          <strong className="block">{status.label}</strong>
          <span className="mt-0.5 block leading-5">{status.detail}</span>
        </div>
      </div>

      <p className="mt-4 mb-0 text-sm leading-6 text-[var(--ink)]">
        No occupancy date has been reported yet.{" "}
        {historical ? (
          <>
            Comparable infill permits have a median reported occupancy timing of about{" "}
            <strong>{typicalDuration}</strong> after the building permit is issued.
          </>
        ) : (
          <>
            The planning baseline places the typical point about <strong>{typicalDuration}</strong>{" "}
            after the building permit is issued.
          </>
        )}
      </p>
      <p className="mt-2 mb-0 text-xs leading-5 text-[var(--muted)]">
        {historical ? (
          <>
            Based on {estimate.occupancyCount.toLocaleString("en-CA")} reported occupancies among{" "}
            {estimate.cohortSize.toLocaleString("en-CA")} comparable {scopeLabel} building permits.
          </>
        ) : (
          <>
            This is an explicit <strong>18-month planning baseline</strong> because there is not
            enough comparable permit history for a reliable local estimate.
          </>
        )}
      </p>

      <figure className="mt-5 mb-0" role="img" aria-label={accessibleSummary}>
        <div className="relative pt-7" aria-hidden="true">
          <div
            className="absolute top-0 flex -translate-x-1/2 items-center gap-1 text-[11px] font-bold whitespace-nowrap text-[var(--spruce)]"
            style={{ left: `${nowPosition}%` }}
          >
            <span className="size-2 rotate-45 bg-[var(--spruce)]" />
            <span className={nowPosition < 12 || nowPosition > 88 ? "sr-only" : ""}>
              Now · {elapsedDuration}
            </span>
          </div>
          <div className="relative h-3 overflow-visible rounded-full bg-[linear-gradient(90deg,var(--positive)_0%,#8b9b46_45%,var(--warning)_67%,var(--critical)_100%)]">
            <span
              className="absolute top-[-4px] h-5 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgba(23,48,51,0.55)]"
              style={{ left: `${typicalPosition}%` }}
            />
            <span
              className="absolute top-[-6px] h-6 w-1 -translate-x-1/2 rounded-full bg-[var(--spruce)] shadow-[0_0_0_2px_white]"
              style={{ left: `${nowPosition}%` }}
            />
          </div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] leading-4 text-[var(--muted)] sm:text-[11px]">
          <span>Permit issued</span>
          <span className="text-center">Typical · {typicalDuration}</span>
          <span className="text-right">2 years</span>
        </div>
        <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-[var(--ink)]">
          <span className="inline-flex items-center gap-1.5 font-semibold">
            <span className="size-2 rotate-45 bg-[var(--spruce)]" aria-hidden="true" />
            Now · {elapsedDuration} elapsed
          </span>
          <span>Estimated typical date · {formatDate(estimate.estimatedDate)}</span>
        </figcaption>
      </figure>

      <p className="mt-4 mb-0 border-t border-[var(--border)] pt-3 text-xs leading-5 text-[var(--muted)]">
        This estimate is a timing guide, not a deadline or a claim that the building is safe or
        ready to occupy. Only a reported City occupancy date confirms that milestone. Durations
        beyond two years are capped in the comparison so unusually long projects do not skew the
        result.
      </p>
    </section>
  );
}
