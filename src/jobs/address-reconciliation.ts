import type { PrismaClient } from "../generated/prisma/client";
import { JobType, RunStatus } from "../generated/prisma/enums";
import { CURRENT_ADDRESS_NORMALIZATION_VERSION } from "../domain/address-normalization";
import { isUniqueConstraintError, permitImportConflictKey } from "./permit-import-job";

const reconciliationAdvisoryLockName = "edmonton-infill-tracker:worker:address-reconciliation";

export type AddressReconciliationQueueResult =
  | { status: "not-needed" }
  | { status: "covered"; jobType: JobType }
  | { status: "deferred"; jobType: JobType | null }
  | { status: "backlog-remains" }
  | { status: "enqueued"; jobId: string };

export const ADDRESS_RECONCILIATION_MAX_ENQUEUES_PER_PROCESS = 2;

/**
 * Makes a migration-created address-repair backlog durable even when the
 * migration could not reserve the permit/project pipeline conflict key.
 *
 * Import and matching stages already lead through matching, so they cover the
 * backlog. Reclassification is the terminal stage; callers retry after it
 * releases the shared key. The worker re-checks after matching and bounds how
 * many new repair jobs it can enqueue, so partial failures remain visible
 * without creating a hot retry loop.
 */
export async function ensureAddressReconciliationJob(
  db: PrismaClient,
  options: { allowEnqueue?: boolean } = {},
): Promise<AddressReconciliationQueueResult> {
  try {
    return await db.$transaction(async (transaction) => {
      await transaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_advisory_xact_lock(hashtext(${reconciliationAdvisoryLockName})) IS NULL
          AS "acquired"
      `;

      const stalePermit = await transaction.permitEvent.findFirst({
        where: {
          addressNormalizationVersion: { lt: CURRENT_ADDRESS_NORMALIZATION_VERSION },
        },
        select: { id: true },
      });
      if (!stalePermit) return { status: "not-needed" } as const;

      const activePipeline = await transaction.jobRun.findFirst({
        where: { conflictKey: permitImportConflictKey },
        select: { jobType: true },
      });
      if (activePipeline) {
        if (
          activePipeline.jobType === JobType.INCREMENTAL_PERMIT_IMPORT ||
          activePipeline.jobType === JobType.PROJECT_MATCHING
        ) {
          return { status: "covered", jobType: activePipeline.jobType } as const;
        }
        return { status: "deferred", jobType: activePipeline.jobType } as const;
      }

      if (options.allowEnqueue === false) {
        return { status: "backlog-remains" } as const;
      }

      const job = await transaction.jobRun.create({
        data: {
          jobType: JobType.PROJECT_MATCHING,
          status: RunStatus.PENDING,
          conflictKey: permitImportConflictKey,
          metadata: {
            source: "worker-startup",
            reason: "address-normalization-backlog",
            addressNormalizationVersion: CURRENT_ADDRESS_NORMALIZATION_VERSION,
          },
        },
        select: { id: true },
      });
      return { status: "enqueued", jobId: job.id } as const;
    });
  } catch (error) {
    // The scheduler or another worker can reserve the shared conflict key
    // after our check. Retry on the next worker loop and inspect that owner.
    if (isUniqueConstraintError(error)) {
      return { status: "deferred", jobType: null };
    }
    throw error;
  }
}
