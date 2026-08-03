import type { Metadata } from "next";
import { OverviewDashboard } from "@/components/overview/overview-dashboard";
import { requireUser } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import {
  getDashboardOverview,
  getPreviewDashboardOverview,
  parseDashboardPeriod,
} from "@/src/services/project-read-model";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string | string[] }>;
}) {
  const period = parseDashboardPeriod((await searchParams).period);
  const preview = !process.env.DATABASE_URL && process.env.AUTH_REQUIRED !== "true";
  if (!preview && process.env.AUTH_REQUIRED === "true") await requireUser("/");
  const now = new Date();
  const data = preview
    ? getPreviewDashboardOverview(now, period)
    : await getDashboardOverview(await getDb(), now, period);
  return (
    <OverviewDashboard
      data={data}
      mapStyleUrl={process.env.MAP_STYLE_URL}
      mapTileUrl={process.env.MAP_TILE_URL}
    />
  );
}
