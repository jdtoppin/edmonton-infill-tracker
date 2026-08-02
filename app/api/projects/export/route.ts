import { NextResponse } from "next/server";
import { getCurrentUser } from "@/src/lib/auth";
import { getDb } from "@/src/lib/db";
import { log } from "@/src/lib/logger";
import { clientAddress, rateLimit } from "@/src/lib/request-security";
import {
  assertCsvExportSize,
  getPreviewProjectPage,
  listProjectsForExport,
  projectsToCsv,
  safeParseProjectFilters,
} from "@/src/services/project-read-model";

export const dynamic = "force-dynamic";

const headers = {
  "cache-control": "private, no-store",
  "content-type": "text/csv; charset=utf-8",
  "content-disposition": 'attachment; filename="edmonton-infill-projects.csv"',
  "x-content-type-options": "nosniff",
};

export async function GET(request: Request) {
  const preview = !process.env.DATABASE_URL && process.env.AUTH_REQUIRED !== "true";
  const user = preview ? null : await getCurrentUser();
  if (process.env.AUTH_REQUIRED === "true" && !user) {
    return NextResponse.json(
      { error: "Sign in is required." },
      { status: 401, headers: { "cache-control": "private, no-store" } },
    );
  }
  const limit = rateLimit(`project-csv:${user?.id ?? clientAddress(request)}`, 5, 15 * 60 * 1_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many exports. Try again later." },
      {
        status: 429,
        headers: {
          "cache-control": "private, no-store",
          "retry-after": String(limit.retryAfter),
        },
      },
    );
  }
  const parsed = safeParseProjectFilters(new URL(request.url).searchParams);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "The export filters are invalid." },
      { status: 400, headers: { "cache-control": "private, no-store" } },
    );
  }

  try {
    let items;
    if (preview) {
      const page = getPreviewProjectPage({ ...parsed.data, page: 1, pageSize: 100 });
      items = page.items;
      assertCsvExportSize(page.total);
    } else {
      const result = await listProjectsForExport(await getDb(), parsed.data);
      assertCsvExportSize(result.total);
      items = result.items;
    }
    return new NextResponse(`\uFEFF${projectsToCsv(items)}`, { headers });
  } catch (error) {
    if (error instanceof RangeError) {
      return NextResponse.json(
        { error: error.message },
        { status: 413, headers: { "cache-control": "private, no-store" } },
      );
    }
    log("error", "projects.csv.failed", {
      actorUserId: user?.id ?? null,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "The CSV export is temporarily unavailable." },
      { status: 503, headers: { "cache-control": "private, no-store" } },
    );
  }
}
