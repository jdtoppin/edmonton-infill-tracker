import { z } from "zod";
import { ImportMode, RunStatus } from "../generated/prisma/enums";
import { getDb } from "../lib/db";

const argumentsSchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine(({ from, to }) => from <= to, { message: "The start date must be before the end date." });

const values = Object.fromEntries(
  process.argv.slice(2).map((argument) => {
    const [key, value] = argument.replace(/^--/, "").split("=", 2);
    return [key, value];
  }),
);

const parsed = argumentsSchema.safeParse(values);
if (!parsed.success) {
  console.error("Usage: npm run import:backfill -- --from=2026-01-01 --to=2026-01-31");
  console.error(parsed.error.issues.map((issue) => issue.message).join("\n"));
  process.exitCode = 1;
} else {
  const run = await getDb().importRun.create({
    data: {
      sourceProvider: "edmonton-open-data",
      mode: ImportMode.BACKFILL,
      status: RunStatus.PENDING,
      requestedFrom: parsed.data.from,
      requestedTo: parsed.data.to,
    },
  });
  console.info(JSON.stringify({ event: "backfill.queued", importRunId: run.id }));
  await getDb().$disconnect();
}
