import { JobType, RunStatus } from "../generated/prisma/enums";
import { getDb } from "../lib/db";
import { log } from "../lib/logger";
import { edmontonProviderFromEnv } from "../providers";
import { PrismaPermitImportRepository, runPermitImport } from "../services/permit-import";
import {
  claimNextJob as claimQueuedJob,
  extendJobLease as renewJobLease,
  recoverExpiredJobs,
  type ClaimedJob,
} from "./job-lease";
import { jobDate, parsePermitImportJobMetadata } from "./permit-import-job";

const pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15_000);
const jobLeaseMs = Number(process.env.WORKER_JOB_LEASE_MS ?? 120_000);
const heartbeatMs = Math.max(1_000, Math.min(30_000, Math.floor(jobLeaseMs / 3)));
let stopping = false;
let wakeWorker: (() => void) | undefined;
let activeJobController: AbortController | undefined;

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

async function processJob(job: ClaimedJob) {
  const db = await getDb();
  const controller = new AbortController();
  activeJobController = controller;
  let heartbeatActive = false;
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

    if (job.jobType !== JobType.INCREMENTAL_PERMIT_IMPORT) {
      throw new Error(`No handler is registered for ${job.jobType}.`);
    }

    const metadata = parsePermitImportJobMetadata(job.metadata);
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
    let processedCount = 0;
    let successfulCount = 0;
    let failedCount = 0;
    let partial = false;
    const failures: string[] = [];

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
        processedCount += result.counts.fetched;
        successfulCount += result.counts.created + result.counts.updated + result.counts.skipped;
        failedCount += result.counts.failed;
        partial ||= result.status === "PARTIALLY_SUCCEEDED";
      } catch (error) {
        partial ||= successfulCount > 0 || processedCount > 0;
        failedCount += 1;
        failures.push(`${dataset}:${error instanceof Error ? error.name : "UnknownError"}`);
        log("error", "permit-import.dataset-failed", {
          jobId: job.id,
          dataset,
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
        if (controller.signal.aborted) break;
      }
    }

    const status =
      controller.signal.aborted || failures.length === metadata.datasets.length
        ? RunStatus.FAILED
        : partial || failedCount > 0
          ? RunStatus.PARTIALLY_SUCCEEDED
          : RunStatus.SUCCEEDED;
    await db.jobRun.updateMany({
      where: { id: job.id, status: RunStatus.RUNNING, lockKey: job.lockKey },
      data: {
        status,
        lockKey: null,
        conflictKey: null,
        heartbeatAt: null,
        lockExpiresAt: null,
        processedCount,
        successfulCount,
        failedCount,
        completedAt: new Date(),
        errorSummary: failures.length > 0 ? failures.join(", ").slice(0, 1_000) : null,
      },
    });
    log("info", "job.completed", { jobId: job.id, jobType: job.jobType });
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
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
