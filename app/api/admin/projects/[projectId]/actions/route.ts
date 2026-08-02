import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizeApiAdmin } from "@/src/lib/api-auth";
import { getDb } from "@/src/lib/db";
import { log } from "@/src/lib/logger";
import { rateLimit, requestOriginIsAllowed } from "@/src/lib/request-security";
import {
  adminProjectActionSchema,
  projectIdentifierSchema,
} from "@/src/services/admin/project-review-request";
import {
  markProjectNotRelevant,
  mergeProjects,
  ProjectIntelligenceError,
  ProjectMergeConflictError,
  reassignPermitEvent,
  setProjectManualOverride,
} from "@/src/services/project-intelligence";

const noStore = { "cache-control": "private, no-store" };

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
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
  const limit = rateLimit(`admin-project:${authorization.user.id}`, 30, 15 * 60 * 1_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many review changes. Try again later." },
      { status: 429, headers: { ...noStore, "retry-after": String(limit.retryAfter) } },
    );
  }

  try {
    const projectId = projectIdentifierSchema.parse((await params).projectId);
    const action = adminProjectActionSchema.parse(await request.json().catch(() => null));
    const db = await getDb();
    const current = await db.project.findUnique({
      where: { id: projectId },
      select: { updatedAt: true, mergedIntoId: true },
    });
    if (!current || current.mergedIntoId) {
      return NextResponse.json(
        { error: "The active project was not found." },
        { status: 404, headers: noStore },
      );
    }
    if (current.updatedAt.toISOString() !== action.expectedUpdatedAt) {
      return NextResponse.json(
        { error: "This project changed in another session. Reload before applying a review." },
        { status: 409, headers: noStore },
      );
    }

    if (action.action === "override") {
      await setProjectManualOverride(db, {
        projectId,
        actorUserId: authorization.user.id,
        reason: action.reason,
        category: action.category,
        stage: action.stage,
        reviewStatus: action.reviewStatus,
      });
    } else if (action.action === "not-relevant") {
      await markProjectNotRelevant(db, {
        projectId,
        actorUserId: authorization.user.id,
        reason: action.reason,
      });
    } else if (action.action === "merge") {
      await mergeProjects(db, {
        sourceProjectId: projectId,
        targetProjectId: action.targetProjectId,
        actorUserId: authorization.user.id,
        reason: action.reason,
      });
    } else {
      await reassignPermitEvent(db, {
        permitEventId: action.permitEventId,
        targetProjectId: action.targetProjectId,
        actorUserId: authorization.user.id,
        reason: action.reason,
      });
    }

    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "The review request is invalid." },
        { status: 422, headers: noStore },
      );
    }
    if (error instanceof ProjectMergeConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409, headers: noStore });
    }
    if (error instanceof ProjectIntelligenceError) {
      return NextResponse.json({ error: error.message }, { status: 422, headers: noStore });
    }
    log("error", "admin.project-review.failed", {
      actorUserId: authorization.user.id,
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json(
      { error: "The review action could not be saved. Check system health and try again." },
      { status: 503, headers: noStore },
    );
  }
}
