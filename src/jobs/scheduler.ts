import { JobType, RunStatus } from "../generated/prisma/enums";
import { getDb } from "../lib/db";
import { log } from "../lib/logger";
import {
  dataQualityConflictKey,
  isUniqueConstraintError,
  permitImportConflictKey,
} from "./permit-import-job";

const intervalMs = Number(process.env.SCHEDULER_INTERVAL_MS ?? 60 * 60 * 1000);
let stopping = false;
let wakeScheduler: (() => void) | undefined;

function waitForNextRun() {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      wakeScheduler = undefined;
      resolve();
    }, intervalMs);
    wakeScheduler = () => {
      clearTimeout(timer);
      wakeScheduler = undefined;
      resolve();
    };
  });
}

async function enqueueDataQualityCheck() {
  const db = await getDb();
  try {
    const job = await db.jobRun.create({
      data: {
        jobType: JobType.DATA_QUALITY_CHECK,
        status: RunStatus.PENDING,
        conflictKey: dataQualityConflictKey,
        metadata: { source: "scheduler" },
      },
    });
    log("info", "scheduler.enqueued", { jobId: job.id, jobType: job.jobType });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

async function enqueuePermitImport() {
  const db = await getDb();
  try {
    const job = await db.jobRun.create({
      data: {
        jobType: JobType.INCREMENTAL_PERMIT_IMPORT,
        status: RunStatus.PENDING,
        conflictKey: permitImportConflictKey,
        metadata: {
          mode: "incremental",
          datasets: ["development", "building"],
          source: "scheduler",
        },
      },
    });
    log("info", "scheduler.enqueued", { jobId: job.id, jobType: job.jobType });
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error;
  }
}

async function main() {
  const db = await getDb();
  await db.$queryRaw`SELECT 1`;
  log("info", "scheduler.ready", { intervalMs });

  while (!stopping) {
    await enqueuePermitImport();
    await enqueueDataQualityCheck();
    await waitForNextRun();
  }

  await db.$disconnect();
  log("info", "scheduler.stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    wakeScheduler?.();
  });
}

main().catch((error) => {
  log("error", "scheduler.crashed", {
    errorName: error instanceof Error ? error.name : "UnknownError",
  });
  process.exitCode = 1;
});
