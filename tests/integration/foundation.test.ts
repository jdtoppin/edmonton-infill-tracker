import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("self-hosted foundation", () => {
  it("keeps PostgreSQL private while exposing the web through Caddy", async () => {
    const compose = await readFile(new URL("../../docker-compose.yml", import.meta.url), "utf8");
    expect(compose).toContain("internal: true");
    expect(compose).not.toMatch(/\n\s+ports:\n\s+- ["']?5432/);
    expect(compose).toContain("/api/health");
  });

  it("declares idempotency constraints in the persistent model", async () => {
    const schema = await readFile(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
    expect(schema).toContain("@@unique([sourceProvider, sourceRecordIdentifier])");
    expect(schema).toContain("idempotencyKey");
    expect(schema).toContain("tokenHash");
  });
});
