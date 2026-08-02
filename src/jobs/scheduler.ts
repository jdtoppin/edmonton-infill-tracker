import { getDb } from "../lib/db";
import { log } from "../lib/logger";
import { DEFAULT_SCHEDULER_INTERVAL_MS, scheduleRecurringJobs } from "./scheduled-jobs";

const maximumTimerDelayMs = 2_147_483_647;
const configuredInterval = process.env.SCHEDULER_INTERVAL_MS;
const intervalMs = configuredInterval ? Number(configuredInterval) : DEFAULT_SCHEDULER_INTERVAL_MS;
let stopping = false;
let wakeScheduler: (() => void) | undefined;

function waitUntil(nextRunAt: Date) {
  return new Promise<void>((resolve) => {
    const delayMs = Math.min(maximumTimerDelayMs, Math.max(0, nextRunAt.getTime() - Date.now()));
    const timer = setTimeout(() => {
      wakeScheduler = undefined;
      resolve();
    }, delayMs);
    wakeScheduler = () => {
      clearTimeout(timer);
      wakeScheduler = undefined;
      resolve();
    };
  });
}

async function main() {
  const db = await getDb();
  await db.$queryRaw`SELECT 1`;
  log("info", "scheduler.ready", { intervalMs });

  while (!stopping) {
    const result = await scheduleRecurringJobs(db, { intervalMs });
    if (result.status === "enqueued") {
      log("info", "scheduler.enqueued", {
        permitImportJobId: result.permitImportJobId,
        dataQualityJobId: result.dataQualityJobId,
        nextRunAt: result.nextRunAt.toISOString(),
      });
    } else {
      log("info", `scheduler.${result.status}`, {
        nextRunAt: result.nextRunAt.toISOString(),
      });
    }
    if (!stopping) await waitUntil(result.nextRunAt);
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
