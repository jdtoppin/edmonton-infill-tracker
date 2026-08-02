import { randomUUID } from "node:crypto";
import { JobType, RunStatus } from "../generated/prisma/enums";
import { getDb } from "../lib/db";
import { log } from "../lib/logger";

const pollMs = Number(process.env.WORKER_POLL_INTERVAL_MS ?? 15_000);
let stopping = false;
let wakeWorker: (() => void) | undefined;

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
  const db = getDb();
  const pending = await db.jobRun.findFirst({
    where: { status: RunStatus.PENDING },
    orderBy: { createdAt: "asc" },
  });
  if (!pending) return null;

  const lockKey = `${process.env.HOSTNAME ?? "worker"}:${randomUUID()}`;
  const claimed = await db.jobRun.updateMany({
    where: { id: pending.id, status: RunStatus.PENDING, lockKey: null },
    data: { status: RunStatus.RUNNING, lockKey, startedAt: new Date() },
  });
  return claimed.count === 1 ? { ...pending, lockKey } : null;
}

async function processJob(job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>) {
  const db = getDb();
  try {
    if (job.jobType !== JobType.DATA_QUALITY_CHECK) {
      throw new Error(`No Phase 1 handler is registered for ${job.jobType}.`);
    }

    await db.$queryRaw`SELECT 1`;
    await db.jobRun.update({
      where: { id: job.id },
      data: {
        status: RunStatus.SUCCEEDED,
        lockKey: null,
        processedCount: 1,
        successfulCount: 1,
        completedAt: new Date(),
      },
    });
    log("info", "job.completed", { jobId: job.id, jobType: job.jobType });
  } catch (error) {
    await db.jobRun.update({
      where: { id: job.id },
      data: {
        status: RunStatus.FAILED,
        lockKey: null,
        failedCount: 1,
        completedAt: new Date(),
        errorSummary: error instanceof Error ? error.message : "Unknown job failure",
      },
    });
    log("error", "job.failed", { jobId: job.id, jobType: job.jobType });
  }
}

async function main() {
  await getDb().$queryRaw`SELECT 1`;
  log("info", "worker.ready", { pollMs });

  while (!stopping) {
    const job = await claimNextJob();
    if (job) await processJob(job);
    else await waitForWork();
  }

  await getDb().$disconnect();
  log("info", "worker.stopped");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
    wakeWorker?.();
  });
}

main().catch((error) => {
  log("error", "worker.crashed", {
    message: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
