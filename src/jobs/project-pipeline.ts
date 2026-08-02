import type { PrismaClient } from "../generated/prisma/client";
import { JobType, RunStatus } from "../generated/prisma/enums";
import type { ClaimedJob } from "./job-lease";
import {
  projectMatchingConflictKey,
  projectReclassificationConflictKey,
} from "./permit-import-job";

export interface PipelineStageCompletion {
  status: RunStatus;
  processedCount: number;
  successfulCount: number;
  failedCount: number;
  errorSummary: string | null;
}

export function nextProjectPipelineStage(jobType: JobType): JobType | null {
  if (jobType === JobType.INCREMENTAL_PERMIT_IMPORT) return JobType.PROJECT_MATCHING;
  if (jobType === JobType.PROJECT_MATCHING) return JobType.PROJECT_RECLASSIFICATION;
  return null;
}

/** Completes one owned stage and creates its successor in the same transaction. */
export async function completeProjectPipelineStage(
  db: PrismaClient,
  job: ClaimedJob,
  completion: PipelineStageCompletion,
): Promise<boolean> {
  return db.$transaction(async (transaction) => {
    const completedAt = new Date();
    const completed = await transaction.jobRun.updateMany({
      where: {
        id: job.id,
        status: RunStatus.RUNNING,
        lockKey: job.lockKey,
        lockExpiresAt: { gt: completedAt },
      },
      data: {
        ...completion,
        lockKey: null,
        conflictKey: null,
        heartbeatAt: null,
        lockExpiresAt: null,
        completedAt,
      },
    });
    if (completed.count !== 1) return false;

    const nextJobType = nextProjectPipelineStage(job.jobType);
    if (nextJobType) {
      await transaction.jobRun.create({
        data: {
          jobType: nextJobType,
          status: RunStatus.PENDING,
          conflictKey:
            nextJobType === JobType.PROJECT_MATCHING
              ? projectMatchingConflictKey
              : projectReclassificationConflictKey,
          metadata: { source: "pipeline", previousJobRunId: job.id },
        },
      });
    }
    return true;
  });
}
