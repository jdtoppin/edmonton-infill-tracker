import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizeApiAdmin } from "@/src/lib/api-auth";
import { getDb } from "@/src/lib/db";
import { log } from "@/src/lib/logger";
import { rateLimit, requestOriginIsAllowed } from "@/src/lib/request-security";
import { enqueueAdminPermitImport } from "@/src/services/admin";

const noStore = { "cache-control": "private, no-store" };

export async function POST(request: Request) {
  if (!requestOriginIsAllowed(request)) {
    return NextResponse.json(
      { error: "Request origin was not accepted." },
      { status: 403, headers: noStore },
    );
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "JSON content is required." },
      { status: 415, headers: noStore },
    );
  }

  const authorization = await authorizeApiAdmin();
  if (!authorization.ok) {
    return NextResponse.json(
      { error: authorization.error.message },
      { status: authorization.status, headers: noStore },
    );
  }
  const limit = rateLimit(`admin-import:${authorization.user.id}`, 10, 15 * 60 * 1000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many import requests. Try again later." },
      { status: 429, headers: { ...noStore, "retry-after": String(limit.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => null);
  try {
    const result = await enqueueAdminPermitImport(await getDb(), authorization.user, body);
    if (result.status === "conflict") {
      return NextResponse.json(
        { error: "Another permit import or project pipeline is already queued or running." },
        { status: 409, headers: noStore },
      );
    }
    return NextResponse.json({ ok: true, jobId: result.jobId }, { status: 202, headers: noStore });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "The import request is invalid." },
        { status: 422, headers: noStore },
      );
    }
    log("error", "admin.import.queue-failed", {
      actorUserId: authorization.user.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "The import could not be queued. Check system health and try again." },
      { status: 503, headers: noStore },
    );
  }
}
