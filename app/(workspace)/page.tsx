import type { Metadata } from "next";
import { OverviewDashboard } from "@/components/overview/overview-dashboard";
import { requireUser } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import {
  getDashboardOverview,
  getPreviewDashboardOverview,
} from "@/src/services/project-read-model";

export const metadata: Metadata = { title: "Overview" };
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const preview = !process.env.DATABASE_URL && process.env.AUTH_REQUIRED !== "true";
  if (!preview && process.env.AUTH_REQUIRED === "true") await requireUser("/");
  const data = preview ? getPreviewDashboardOverview() : await getDashboardOverview(await getDb());
  return <OverviewDashboard data={data} />;
}
