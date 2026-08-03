import type { PrismaClient } from "../generated/prisma/client";
import { ProjectMatchStatus } from "../generated/prisma/enums";
import { CURRENT_ADDRESS_NORMALIZATION_VERSION } from "../domain/address-normalization";
import {
  assertActiveProjectJobLease,
  matchPermitEvent,
  ProjectJobLeaseLostError,
  recomputeProject,
  type ProjectMutationFence,
} from "../services/project-intelligence";

const batchSize = 500;

export interface ProjectIntelligenceJobResult {
  processed: number;
  successful: number;
  failed: number;
  failureSamples: Array<{ recordId: string; errorName: string }>;
}

function recordFailure(
  result: ProjectIntelligenceJobResult,
  recordId: string,
  error: unknown,
): void {
  result.failed += 1;
  if (result.failureSamples.length >= 10) return;
  result.failureSamples.push({
    recordId,
    errorName: error instanceof Error ? error.constructor.name : "UnknownError",
  });
}

/**
 * Walks a stable ID cursor so one malformed permit cannot trap every later
 * permit behind the first page. A later job can retry any failed, still-unlinked
 * events after their data or matching prerequisites are corrected.
 */
export async function runProjectMatchingJob(
  db: PrismaClient,
  signal?: AbortSignal,
  fence?: ProjectMutationFence,
): Promise<ProjectIntelligenceJobResult> {
  const result: ProjectIntelligenceJobResult = {
    processed: 0,
    successful: 0,
    failed: 0,
    failureSamples: [],
  };
  let afterId: string | undefined;

  while (true) {
    signal?.throwIfAborted();
    const permits = await db.permitEvent.findMany({
      where: {
        OR: [
          { projectMatchStatus: ProjectMatchStatus.PENDING },
          { addressNormalizationVersion: { lt: CURRENT_ADDRESS_NORMALIZATION_VERSION } },
        ],
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (permits.length === 0) break;

    for (const permit of permits) {
      signal?.throwIfAborted();
      result.processed += 1;
      try {
        await matchPermitEvent(db, permit.id, { fence });
        result.successful += 1;
      } catch (error) {
        if (error instanceof ProjectJobLeaseLostError) throw error;
        recordFailure(result, permit.id, error);
      }
    }

    afterId = permits.at(-1)?.id;
    if (permits.length < batchSize) break;
  }

  return result;
}

/** Re-applies current scoring rules while preserving durable manual overrides. */
export async function runProjectReclassificationJob(
  db: PrismaClient,
  signal?: AbortSignal,
  fence?: ProjectMutationFence,
): Promise<ProjectIntelligenceJobResult> {
  const result: ProjectIntelligenceJobResult = {
    processed: 0,
    successful: 0,
    failed: 0,
    failureSamples: [],
  };
  let afterId: string | undefined;

  while (true) {
    signal?.throwIfAborted();
    const projects = await db.project.findMany({
      where: {
        mergedIntoId: null,
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: batchSize,
    });
    if (projects.length === 0) break;

    for (const project of projects) {
      signal?.throwIfAborted();
      result.processed += 1;
      try {
        await db.$transaction(
          async (transaction) => {
            if (fence) await assertActiveProjectJobLease(transaction, fence);
            return recomputeProject(transaction, project.id);
          },
          { isolationLevel: "Serializable" },
        );
        result.successful += 1;
      } catch (error) {
        if (error instanceof ProjectJobLeaseLostError) throw error;
        recordFailure(result, project.id, error);
      }
    }

    afterId = projects.at(-1)?.id;
    if (projects.length < batchSize) break;
  }

  return result;
}
