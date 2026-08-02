import { JobType, RunStatus } from "../generated/prisma/enums";
import { getDb } from "../lib/db";
import { log } from "../lib/logger";

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
  const db = getDb();
  const existing = await db.jobRun.findFirst({
    where: {
      jobType: JobType.DATA_QUALITY_CHECK,
      status: { in: [RunStatus.PENDING, RunStatus.RUNNING] },
    },
  });
  if (existing) return;

  const job = await db.jobRun.create({
    data: {
      jobType: JobType.DATA_QUALITY_CHECK,
      status: RunStatus.PENDING,
      metadata: { source: "scheduler" },
    },
  });
  log("info", "scheduler.enqueued", { jobId: job.id, jobType: job.jobType });
}

async function main() {
  await getDb().$queryRaw`SELECT 1`;
  log("info", "scheduler.ready", { intervalMs });

  while (!stopping) {
    await enqueueDataQualityCheck();
    await waitForNextRun();
  }

  await getDb().$disconnect();
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
    message: error instanceof Error ? error.message : "Unknown error",
  });
  process.exitCode = 1;
});
