export const DASHBOARD_PERIOD_OPTIONS = [
  { value: 7, label: "7 days", windowLabel: "Past 7 days" },
  { value: 30, label: "30 days", windowLabel: "Past 30 days" },
  { value: 90, label: "90 days", windowLabel: "Past 90 days" },
  { value: 180, label: "180 days", windowLabel: "Past 180 days" },
  { value: 365, label: "365 days", windowLabel: "Past 365 days" },
  { value: 730, label: "Two years", windowLabel: "Past two years" },
  { value: "all", label: "All time", windowLabel: "All time" },
] as const;

export type DashboardPeriod = (typeof DASHBOARD_PERIOD_OPTIONS)[number]["value"];

export type DashboardRange = {
  period: DashboardPeriod;
  label: string;
  windowLabel: string;
  from: string | null;
  through: string;
};

export const DEFAULT_DASHBOARD_PERIOD: DashboardPeriod = 7;

export function parseDashboardPeriod(
  value: string | readonly string[] | null | undefined,
): DashboardPeriod {
  const candidate = Array.isArray(value) ? value[0] : value;
  switch (candidate) {
    case "7":
      return 7;
    case "30":
      return 30;
    case "90":
      return 90;
    case "180":
      return 180;
    case "365":
      return 365;
    case "730":
      return 730;
    case "all":
      return "all";
    default:
      return DEFAULT_DASHBOARD_PERIOD;
  }
}

function edmontonCivilDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Edmonton",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function dashboardRange(period: DashboardPeriod, now = new Date()): DashboardRange {
  const option =
    DASHBOARD_PERIOD_OPTIONS.find((candidate) => candidate.value === period) ??
    DASHBOARD_PERIOD_OPTIONS[0];
  const through = edmontonCivilDate(now);
  const throughDate = new Date(`${through}T00:00:00.000Z`);
  const from =
    typeof option.value === "number"
      ? new Date(
          Date.UTC(
            throughDate.getUTCFullYear(),
            throughDate.getUTCMonth(),
            throughDate.getUTCDate() - (option.value - 1),
          ),
        )
          .toISOString()
          .slice(0, 10)
      : null;

  return {
    period: option.value,
    label: option.label,
    windowLabel: option.windowLabel,
    from,
    through,
  };
}
