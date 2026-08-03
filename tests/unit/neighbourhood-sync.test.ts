import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "../../src/generated/prisma/client";
import { NeighbourhoodNameSource } from "../../src/generated/prisma/enums";
import type { EdmontonNeighbourhood } from "../../src/providers/edmonton-neighbourhoods";
import {
  PrismaNeighbourhoodNameSyncRepository,
  syncEdmontonNeighbourhoodNames,
} from "../../src/services/neighbourhood-sync";
import { upsertPermitNeighbourhood } from "../../src/services/permit-import/prisma-repository";

const neighbourhoods: EdmontonNeighbourhood[] = [
  {
    cityNeighbourhoodId: "1151",
    name: "Wîhkwêntôwin",
    latitude: 53.5432,
    longitude: -113.5234,
  },
  {
    cityNeighbourhoodId: "5480",
    name: "Queen Alexandra",
    latitude: 53.5123,
    longitude: -113.5012,
  },
];

describe("authoritative neighbourhood name sync", () => {
  it("persists a fetched snapshot only after the provider succeeds", async () => {
    const sourceUpdatedAt = new Date("2026-08-03T12:00:00.000Z");
    const provider = {
      fetchCurrentNeighbourhoods: vi.fn(async () => neighbourhoods),
    };
    const repository = {
      persistAuthoritativeNames: vi.fn(async () => ({
        created: 1,
        updated: 1,
        unchanged: 0,
      })),
    };

    await expect(
      syncEdmontonNeighbourhoodNames({ provider, repository, sourceUpdatedAt }),
    ).resolves.toEqual({ fetched: 2, created: 1, updated: 1, unchanged: 0 });
    expect(repository.persistAuthoritativeNames).toHaveBeenCalledWith(
      neighbourhoods,
      sourceUpdatedAt,
    );
  });

  it("upserts by City neighbourhood ID and marks changed names authoritative", async () => {
    const findMany = vi.fn(async () => [
      {
        cityNeighbourhoodId: "1151",
        name: "Oliver",
        nameSource: NeighbourhoodNameSource.PERMIT,
      },
      {
        cityNeighbourhoodId: "5480",
        name: "Queen Alexandra",
        nameSource: NeighbourhoodNameSource.CITY_CURRENT_CENTROIDS,
      },
    ]);
    const upsert = vi.fn(async () => ({ id: "neighbourhood-id" }));
    const transaction = { neighbourhood: { findMany, upsert } };
    const db = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>) =>
        callback(transaction),
    } as unknown as PrismaClient;
    const repository = new PrismaNeighbourhoodNameSyncRepository(db);
    const sourceUpdatedAt = new Date("2026-08-03T12:00:00.000Z");

    await expect(
      repository.persistAuthoritativeNames(neighbourhoods, sourceUpdatedAt),
    ).resolves.toEqual({ created: 0, updated: 1, unchanged: 1 });
    expect(upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { cityNeighbourhoodId: "1151" },
        update: {
          name: "Wîhkwêntôwin",
          nameSource: NeighbourhoodNameSource.CITY_CURRENT_CENTROIDS,
          nameSourceUpdatedAt: sourceUpdatedAt,
        },
      }),
    );
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { cityNeighbourhoodId: "5480" },
        update: {},
      }),
    );
  });
});

describe("permit neighbourhood name writes", () => {
  function inMemoryDelegate(
    initial: {
      name: string;
      nameSource: NeighbourhoodNameSource;
    } | null,
  ) {
    let row = initial ? { id: "existing", ...initial } : null;
    return {
      get row() {
        return row;
      },
      upsert: vi.fn(async (input) => {
        if (!row) {
          row = {
            id: "created",
            name: input.create.name,
            nameSource: input.create.nameSource,
          };
        }
        return { id: row.id };
      }),
      updateMany: vi.fn(async (input) => {
        const current = row;
        if (
          current &&
          current.id === input.where.id &&
          current.nameSource === input.where.nameSource
        ) {
          current.name = input.data.name;
          return { count: 1 };
        }
        return { count: 0 };
      }),
    };
  }

  it("creates a permit-sourced name when a neighbourhood is first observed", async () => {
    const delegate = inMemoryDelegate(null);
    await expect(upsertPermitNeighbourhood(delegate, "1151", "OLIVER")).resolves.toBe("created");
    expect(delegate.row).toMatchObject({
      name: "OLIVER",
      nameSource: NeighbourhoodNameSource.PERMIT,
    });
  });

  it("refreshes permit-sourced names but never clobbers an authoritative City name", async () => {
    const permitDelegate = inMemoryDelegate({
      name: "OLD PERMIT NAME",
      nameSource: NeighbourhoodNameSource.PERMIT,
    });
    await upsertPermitNeighbourhood(permitDelegate, "1151", "NEW PERMIT NAME");
    expect(permitDelegate.row?.name).toBe("NEW PERMIT NAME");

    const authoritativeDelegate = inMemoryDelegate({
      name: "Wîhkwêntôwin",
      nameSource: NeighbourhoodNameSource.CITY_CURRENT_CENTROIDS,
    });
    await upsertPermitNeighbourhood(authoritativeDelegate, "1151", "OLIVER");
    expect(authoritativeDelegate.row?.name).toBe("Wîhkwêntôwin");
  });
});
