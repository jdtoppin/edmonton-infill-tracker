import type { PrismaClient } from "../generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: Promise<PrismaClient> | undefined;
};

async function createPrismaClient(): Promise<PrismaClient> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error("DATABASE_URL must be set before accessing the database.");
  }

  // Keep Prisma out of the server's startup path. This lets the public product
  // preview start without a database while preserving the full PostgreSQL path
  // for authenticated and operational requests.
  const [{ PrismaPg }, { PrismaClient }] = await Promise.all([
    import("@prisma/adapter-pg"),
    import("../generated/prisma/client"),
  ]);
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({ adapter });
}

export function getDb(): Promise<PrismaClient> {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }

  return globalForPrisma.prisma;
}
