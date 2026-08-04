import { JobType, RunStatus } from "../generated/prisma/enums";
import { getDb } from "../lib/db";
import { log } from "../lib/logger";
import { edmontonNeighbourhoodProviderFromEnv, edmontonProviderFromEnv } from "../providers";
import {
  PrismaNeighbourhoodNameSyncRepository,
  syncEdmontonNeighbourhoodNames,
} from "../services/neighbourhood-sync";
import { PrismaPermitImportRepository, runPermitImport } from "../services/permit-import";
import {
  claimNextJob as claimQueuedJob,
  extendJobLease as renewJobLease,
  recoverExpiredJobs,
  type ClaimedJob,
} from "./job-lease";
import {
  ADDRESS_RECONCILIATION_MAX_ENQUEUES_PER_PROCESS,
  ensureAddressReconciliationJob,
} from "./address-reconciliation";
import { jobDate, parsePermitImportJobMetadata } from "./permit-import-job";
import { completeProjectPipelineStage } from "./project-pipeline";
import {
  runProjectMatchingJob,
  runProjectReclassificationJob,
  type ProjectIntelligenceJobResult,
} from "./project-intelligence-job";

const pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15_000);
const jobLeaseMs = Number(process.env.WORKER_JOB_LEASE_MS ?? 120_000);
const heartbeatMs = Math.max(1_000, Math.min(30_000, Math.floor(jobLeaseMs / 3)));
let stopping = false;
let wakeWorker: (() => void) | undefined;
let activeJobController: AbortController | undefined;
let addressReconciliationMonitoringStopped = false;
let addressReconciliationEnqueues = 0;

if (
  !Number.isFinite(pollMs) ||
  pollMs < 250 ||
  !Number.isFinite(jobLeaseMs) ||
  jobLeaseMs < 10_000
) {
  throw new Error("Worker timing configuration is invalid.");
}

function waitForWork() {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wakeWorker = undefined;
      resolve();
    }, pollMs);
    wakeWorker = () => {
      clearTimeout(timer);
      wakeWorker = undefined;
      resolve();
    };
  });
}

async function claimNextJob() {
  const db = await getDb();
  const recovered = await recoverExpiredJobs(db);
  if (recovered.jobs > 0) {
    log("warn", "worker.jobs-recovered", recovered);
  }
  if (!addressReconciliationMonitoringStopped) {
    const reconciliation = await ensureAddressReconciliationJob(db, {
      allowEnqueue: addressReconciliationEnqueues < ADDRESS_RECONCILIATION_MAX_ENQUEUES_PER_PROCESS,
    });
    if (reconciliation.status === "not-needed") {
      addressReconciliationMonitoringStopped = true;
    }
    if (reconciliation.status === "enqueued") {
      addressReconciliationEnqueues += 1;
      log("info", "worker.address-reconciliation-enqueued", {
        jobId: reconciliation.jobId,
        attempt: addressReconciliationEnqueues,
      });
    } else if (reconciliation.status === "backlog-remains") {
      addressReconciliationMonitoringStopped = true;
      log("error", "worker.address-reconciliation-incomplete", {
        attempts: addressReconciliationEnqueues,
      });
    }
  }
  return claimQueuedJob(db, {
    leaseMs: jobLeaseMs,
    workerName: process.env.HOSTNAME ?? "worker",
  });
}

async function extendJobLease(job: ClaimedJob, controller: AbortController): Promise<void> {
  const db = await getDb();
  const extended = await renewJobLease(db, job, jobLeaseMs);
  if (!extended && !controller.signal.aborted) {
    controller.abort(new Error("The worker lost its job lease."));
  }
}

async function completeProjectIntelligenceJob(
  job: ClaimedJob,
  result: ProjectIntelligenceJobResult,
): Promise<boolean> {
  const db = await getDb();
  const status =
    result.failed === 0
      ? RunStatus.SUCCEEDED
      : result.successful === 0
        ? RunStatus.FAILED
        : RunStatus.PARTIALLY_SUCCEEDED;
  return completeProjectPipelineStage(db, job, {
    status,
    processedCount: result.processed,
    successfulCount: result.successful,
    failedCount: result.failed,
    errorSummary:
      result.failed > 0
        ? `${result.failed} record${result.failed === 1 ? "" : "s"} could not be processed.`
        : null,
  });
}

async function processJob(job: ClaimedJob) {
  const db = await getDb();
  const controller = new AbortController();
  activeJobController = controller;
  let heartbeatActive = false;
  let importProcessedCount = 0;
  let importSuccessfulCount = 0;
  let importFailedCount = 0;
  const importFailures: string[] = [];
  const heartbeat = setInterval(() => {
    if (heartbeatActive) return;
    heartbeatActive = true;
    void extendJobLease(job, controller)
      .catch((error) => {
        log("error", "worker.heartbeat-failed", {
          jobId: job.id,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        controller.abort(new Error("The worker could not renew its job lease."));
      })
      .finally(() => {
        heartbeatActive = false;
      });
  }, heartbeatMs);
  heartbeat.unref();

  try {
    if (job.jobType === JobType.DATA_QUALITY_CHECK) {
      await db.$queryRaw`SELECT 1`;
      await db.jobRun.updateMany({
        where: { id: job.id, status: RunStatus.RUNNING, lockKey: job.lockKey },
        data: {
          status: RunStatus.SUCCEEDED,
          lockKey: null,
          conflictKey: null,
          heartbeatAt: null,
          lockExpiresAt: null,
          processedCount: 1,
          successfulCount: 1,
          completedAt: new Date(),
          errorSummary: null,
        },
      });
      log("info", "job.completed", { jobId: job.id, jobType: job.jobType });
      return;
    }

    if (
      job.jobType === JobType.PROJECT_MATCHING ||
      job.jobType === JobType.PROJECT_RECLASSIFICATION
    ) {
      const result =
        job.jobType === JobType.PROJECT_MATCHING
          ? await runProjectMatchingJob(db, controller.signal, {
              jobRunId: job.id,
              leaseToken: job.lockKey,
            })
          : await runProjectReclassificationJob(db, controller.signal, {
              jobRunId: job.id,
              leaseToken: job.lockKey,
            });
      if (!(await completeProjectIntelligenceJob(job, result))) {
        throw new Error("The worker lost its job lease before pipeline handoff.");
      }
      log("info", "job.completed", {
        jobId: job.id,
        jobType: job.jobType,
        ...result,
      });
      return;
    }

    if (job.jobType !== JobType.INCREMENTAL_PERMIT_IMPORT) {
      throw new Error(`No handler is registered for ${job.jobType}.`);
    }

    const metadata = parsePermitImportJobMetadata(job.metadata);
    try {
      const neighbourhoodSync = await syncEdmontonNeighbourhoodNames({
        provider: edmontonNeighbourhoodProviderFromEnv(),
        repository: new PrismaNeighbourhoodNameSyncRepository(db),
        signal: controller.signal,
      });
      log("info", "neighbourhood-sync.completed", {
        jobId: job.id,
        ...neighbourhoodSync,
      });
    } catch (error) {
      if (controller.signal.aborted) throw controller.signal.reason ?? error;
      // Permit ingestion remains available when this supplemental City dataset
      // is temporarily unavailable. Existing authoritative names are retained.
      log("warn", "neighbourhood-sync.failed", {
        jobId: job.id,
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
    const provider = edmontonProviderFromEnv({
      onRequest: (event) =>
        log(event.outcome === "failed" ? "warn" : "info", "permit-provider.request", {
          jobId: job.id,
          dataset: event.sourceDataset,
          operation: event.operation,
          attempt: event.attempt,
          status: event.status,
          durationMs: event.durationMs,
          outcome: event.outcome,
        }),
    });
    const repository = new PrismaPermitImportRepository(db, {
      jobRunId: job.id,
      leaseToken: job.lockKey,
    });
    let partial = false;

    for (const dataset of metadata.datasets) {
      try {
        const result = await runPermitImport({
          provider,
          repository,
          dataset,
          mode: metadata.mode === "backfill" ? "BACKFILL" : "INCREMENTAL",
          from: jobDate(metadata.from),
          to: jobDate(metadata.to),
          signal: controller.signal,
          onEvent: (event) => {
            if (event.type === "page.completed") {
              log("info", "permit-import.page-completed", {
                jobId: job.id,
                dataset,
                ...event.counts,
              });
            } else if (event.type === "row.failed") {
              log("warn", "permit-import.row-quarantined", {
                jobId: job.id,
                dataset,
                sourceRecordIdentifier: event.sourceRecordIdentifier,
                errorCode: event.errorCode,
              });
            }
          },
        });
        importProcessedCount += result.counts.fetched;
        importSuccessfulCount +=
          result.counts.created + result.counts.updated + result.counts.skipped;
        importFailedCount += result.counts.failed;
        partial ||= result.status === "PARTIALLY_SUCCEEDED";
      } catch (error) {
        partial ||= importSuccessfulCount > 0 || importProcessedCount > 0;
        importFailedCount += 1;
        importFailures.push(`${dataset}:${error instanceof Error ? error.name : "UnknownError"}`);
        log("error", "permit-import.dataset-failed", {
          jobId: job.id,
          dataset,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        if (controller.signal.aborted) break;
      }
    }

    const status =
      controller.signal.aborted || importFailures.length === metadata.datasets.length
        ? RunStatus.FAILED
        : partial || importFailedCount > 0
          ? RunStatus.PARTIALLY_SUCCEEDED
          : RunStatus.SUCCEEDED;
    const completed = await completeProjectPipelineStage(db, job, {
      status,
      processedCount: importProcessedCount,
      successfulCount: importSuccessfulCount,
      failedCount: importFailedCount,
      errorSummary: importFailures.length > 0 ? importFailures.join(", ").slice(0, 1_000) : null,
    });
    if (!completed) throw new Error("The worker lost its job lease before pipeline handoff.");
    log("info", "job.completed", { jobId: job.id, jobType: job.jobType });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const isProjectPipelineJob =
      job.jobType === JobType.INCREMENTAL_PERMIT_IMPORT ||
      job.jobType === JobType.PROJECT_MATCHING ||
      job.jobType === JobType.PROJECT_RECLASSIFICATION;
    if (isProjectPipelineJob) {
      try {
        const completed = await completeProjectPipelineStage(db, job, {
          status: RunStatus.FAILED,
          processedCount:
            job.jobType === JobType.INCREMENTAL_PERMIT_IMPORT ? importProcessedCount : 0,
          successfulCount:
            job.jobType === JobType.INCREMENTAL_PERMIT_IMPORT ? importSuccessfulCount : 0,
          failedCount:
            job.jobType === JobType.INCREMENTAL_PERMIT_IMPORT ? importFailedCount + 1 : 1,
          errorSummary: `Job failed with ${errorName}.`,
        });
        if (completed) {
          log("error", "job.failed", { jobId: job.id, jobType: job.jobType });
          return;
        }
      } catch (handoffError) {
        log("error", "job.pipeline-handoff-failed", {
          jobId: job.id,
          errorName: handoffError instanceof Error ? handoffError.name : "UnknownError",
        });
      }
    }
    await db.jobRun.updateMany({
      where: { id: job.id, status: RunStatus.RUNNING, lockKey: job.lockKey },
      data: {
        status: RunStatus.FAILED,
        lockKey: null,
        conflictKey: null,
        heartbeatAt: null,
        lockExpiresAt: null,
        failedCount: 1,
        completedAt: new Date(),
        errorSummary: `Job failed with ${errorName}.`,
      },
    });
    log("error", "job.failed", { jobId: job.id, jobType: job.jobType });
  } finally {
    clearInterval(heartbeat);
    if (activeJobController === controller) activeJobController = undefined;
  }
}

async function main() {
  const db = await getDb();
  await db.$queryRaw`SELECT 1`;
  log("info", "worker.ready", { pollMs, jobLeaseMs });

  while (!stopping) {
    const job = await claimNextJob();
    if (job) await processJob(job);
    else await waitForWork();
  }

  await db.$disconnect();
  log("info", "worker.stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    activeJobController?.abort(new Error("Worker shutdown requested."));
    wakeWorker?.();
  });
}

main().catch((error) => {
  log("error", "worker.crashed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
});
