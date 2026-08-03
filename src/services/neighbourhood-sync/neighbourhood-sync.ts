import type { PrismaClient } from "../../generated/prisma/client";
import { NeighbourhoodNameSource } from "../../generated/prisma/enums";
import type {
  EdmontonNeighbourhood,
  EdmontonNeighbourhoodProvider,
} from "../../providers/edmonton-neighbourhoods";

export interface NeighbourhoodNameSyncResult {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
}

export interface NeighbourhoodNameSyncRepository {
  persistAuthoritativeNames(
    neighbourhoods: readonly EdmontonNeighbourhood[],
    sourceUpdatedAt: Date,
  ): Promise<Omit<NeighbourhoodNameSyncResult, "fetched">>;
}

export class PrismaNeighbourhoodNameSyncRepository implements NeighbourhoodNameSyncRepository {
  constructor(private readonly db: PrismaClient) {}

  async persistAuthoritativeNames(
    neighbourhoods: readonly EdmontonNeighbourhood[],
    sourceUpdatedAt: Date,
  ): Promise<Omit<NeighbourhoodNameSyncResult, "fetched">> {
    if (neighbourhoods.length === 0) {
      throw new Error("An empty neighbourhood snapshot cannot be persisted.");
    }
    if (Number.isNaN(sourceUpdatedAt.getTime())) {
      throw new Error("Neighbourhood source time must be a valid Date.");
    }

    return this.db.$transaction(
      async (transaction) => {
        const cityIds = neighbourhoods.map(({ cityNeighbourhoodId }) => cityNeighbourhoodId);
        const existing = await transaction.neighbourhood.findMany({
          where: { cityNeighbourhoodId: { in: cityIds } },
          select: {
            cityNeighbourhoodId: true,
            name: true,
            nameSource: true,
          },
        });
        const existingByCityId = new Map(
          existing.map((record) => [record.cityNeighbourhoodId, record] as const),
        );
        let created = 0;
        let updated = 0;
        let unchanged = 0;

        for (const neighbourhood of neighbourhoods) {
          const prior = existingByCityId.get(neighbourhood.cityNeighbourhoodId);
          const needsUpdate =
            !prior ||
            prior.name !== neighbourhood.name ||
            prior.nameSource !== NeighbourhoodNameSource.CITY_CURRENT_CENTROIDS;
          await transaction.neighbourhood.upsert({
            where: { cityNeighbourhoodId: neighbourhood.cityNeighbourhoodId },
            create: {
              cityNeighbourhoodId: neighbourhood.cityNeighbourhoodId,
              name: neighbourhood.name,
              nameSource: NeighbourhoodNameSource.CITY_CURRENT_CENTROIDS,
              nameSourceUpdatedAt: sourceUpdatedAt,
            },
            update: needsUpdate
              ? {
                  name: neighbourhood.name,
                  nameSource: NeighbourhoodNameSource.CITY_CURRENT_CENTROIDS,
                  nameSourceUpdatedAt: sourceUpdatedAt,
                }
              : {},
            select: { id: true },
          });

          if (!prior) created += 1;
          else if (needsUpdate) updated += 1;
          else unchanged += 1;
        }

        return { created, updated, unchanged };
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
  }
}

export async function syncEdmontonNeighbourhoodNames(input: {
  provider: EdmontonNeighbourhoodProvider;
  repository: NeighbourhoodNameSyncRepository;
  signal?: AbortSignal;
  sourceUpdatedAt?: Date;
}): Promise<NeighbourhoodNameSyncResult> {
  const neighbourhoods = await input.provider.fetchCurrentNeighbourhoods({
    signal: input.signal,
  });
  if (neighbourhoods.length === 0) {
    throw new Error("The authoritative neighbourhood provider returned no rows.");
  }
  const result = await input.repository.persistAuthoritativeNames(
    neighbourhoods,
    input.sourceUpdatedAt ?? new Date(),
  );
  return { fetched: neighbourhoods.length, ...result };
}
