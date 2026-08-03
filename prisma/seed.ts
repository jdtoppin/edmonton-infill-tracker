import { createHash } from "node:crypto";

import { PrismaPg } from "@prisma/adapter-pg";
import { hash, truncates } from "bcryptjs";

import { normalizeEdmontonAddress } from "../src/domain/address-normalization";
import {
  AlertFrequency,
  MarketListingStatus,
  Prisma,
  PrismaClient,
  ProjectCategory,
  ProjectStage,
  RawRecordStatus,
  ReviewStatus,
  UserRole,
} from "../src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database.");
}

const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

const sourceProvider = "edmonton-open-data-seed";
const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
const timestamp = (value: string) => new Date(value);
const checksum = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

const ids = {
  neighbourhoods: {
    westmount: "seed-neighbourhood-westmount",
    bonnieDoon: "seed-neighbourhood-bonnie-doon",
    ritchie: "seed-neighbourhood-ritchie",
    highlands: "seed-neighbourhood-highlands",
  },
  addresses: {
    detached: "seed-address-detached",
    semiDetached: "seed-address-semi-detached",
    gardenSuite: "seed-address-garden-suite",
    renovation: "seed-address-renovation",
  },
  rawRecords: {
    demolition: "seed-raw-demolition",
    detached: "seed-raw-detached",
    semiDetached: "seed-raw-semi-detached",
    gardenSuite: "seed-raw-garden-suite",
    renovation: "seed-raw-renovation",
  },
  permitEvents: {
    demolition: "seed-permit-demolition",
    detached: "seed-permit-detached",
    semiDetached: "seed-permit-semi-detached",
    gardenSuite: "seed-permit-garden-suite",
    renovation: "seed-permit-renovation",
  },
  projects: {
    detached: "seed-project-detached",
    semiDetached: "seed-project-semi-detached",
    gardenSuite: "seed-project-garden-suite",
    renovation: "seed-project-renovation",
  },
  users: {
    admin: "seed-user-admin",
    standard: "seed-user-standard",
  },
  savedSearch: "seed-saved-search-infill-watch",
} as const;

async function main() {
  const adminEmail = (
    process.env.INITIAL_ADMIN_EMAIL ??
    process.env.SEED_ADMIN_EMAIL ??
    "admin@infill.local"
  )
    .trim()
    .toLowerCase();
  const userEmail = (process.env.SEED_USER_EMAIL ?? "user@infill.local").trim().toLowerCase();

  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  const userPassword = process.env.SEED_USER_PASSWORD;
  if (
    !adminPassword ||
    !userPassword ||
    adminPassword.length < 16 ||
    userPassword.length < 16 ||
    truncates(adminPassword) ||
    truncates(userPassword)
  ) {
    throw new Error(
      "SEED_ADMIN_PASSWORD and SEED_USER_PASSWORD must each contain at least 16 characters without exceeding bcrypt's 72-byte limit; seed credentials never use fallback values.",
    );
  }

  // Only bcrypt hashes, rather than plaintext passwords, are written to the DB.
  const [adminPasswordHash, userPasswordHash] = await Promise.all([
    hash(adminPassword, 12),
    hash(userPassword, 12),
  ]);

  await db.$transaction(async (tx) => {
    const neighbourhoods = [
      {
        id: ids.neighbourhoods.westmount,
        cityNeighbourhoodId: "SEED-WESTMOUNT",
        name: "Westmount",
      },
      {
        id: ids.neighbourhoods.bonnieDoon,
        cityNeighbourhoodId: "SEED-BONNIE-DOON",
        name: "Bonnie Doon",
      },
      {
        id: ids.neighbourhoods.ritchie,
        cityNeighbourhoodId: "SEED-RITCHIE",
        name: "Ritchie",
      },
      {
        id: ids.neighbourhoods.highlands,
        cityNeighbourhoodId: "SEED-HIGHLANDS",
        name: "Highlands",
      },
    ] as const;

    for (const neighbourhood of neighbourhoods) {
      await tx.neighbourhood.upsert({
        where: {
          cityNeighbourhoodId: neighbourhood.cityNeighbourhoodId,
        },
        update: {
          name: neighbourhood.name,
          isMonitoringActive: true,
        },
        create: {
          ...neighbourhood,
          isMonitoringActive: true,
        },
      });
    }

    const addressFixtures = [
      {
        id: ids.addresses.detached,
        rawSourceAddress: "99901 127 Street NW, Edmonton, AB",
        latitude: "53.558800",
        longitude: "-113.552500",
        geocodingConfidence: "0.990",
        neighbourhoodId: ids.neighbourhoods.westmount,
      },
      {
        id: ids.addresses.semiDetached,
        rawSourceAddress: "99902 88 Avenue NW Edmonton Alberta",
        latitude: "53.521900",
        longitude: "-113.460000",
        geocodingConfidence: "0.980",
        neighbourhoodId: ids.neighbourhoods.bonnieDoon,
      },
      {
        id: ids.addresses.gardenSuite,
        rawSourceAddress: "99903 76 Ave NW",
        latitude: "53.512400",
        longitude: "-113.477900",
        geocodingConfidence: "0.970",
        neighbourhoodId: ids.neighbourhoods.ritchie,
      },
      {
        id: ids.addresses.renovation,
        rawSourceAddress: "99904 112 AV NW, Edmonton AB",
        latitude: "53.566800",
        longitude: "-113.427300",
        geocodingConfidence: "0.960",
        neighbourhoodId: ids.neighbourhoods.highlands,
      },
    ] as const;

    for (const fixture of addressFixtures) {
      const normalized = normalizeEdmontonAddress({
        rawSourceAddress: fixture.rawSourceAddress,
      });
      const values = {
        rawSourceAddress: normalized.rawSourceAddress,
        normalizedStreetAddress: normalized.normalizedStreetAddress,
        normalizedAddressKey: normalized.normalizedAddressKey,
        unitNumber: normalized.unitNumber,
        city: normalized.city,
        province: normalized.province,
        postalCode: normalized.postalCode,
        latitude: fixture.latitude,
        longitude: fixture.longitude,
        geocodingConfidence: fixture.geocodingConfidence,
        neighbourhoodId: fixture.neighbourhoodId,
      };

      await tx.address.upsert({
        where: { id: fixture.id },
        update: values,
        create: {
          id: fixture.id,
          ...values,
        },
      });
    }

    const permitFixtures = [
      {
        id: ids.permitEvents.demolition,
        rawRecordId: ids.rawRecords.demolition,
        sourceRecordIdentifier: "SYNTH-DEMO-0001",
        sourceDataset: "building",
        permitNumber: "SEED-DEM-0001",
        permitType: "Building Permit",
        permitSubtype: "Demolition",
        applicationDate: date("2025-01-06"),
        issueDate: date("2025-01-17"),
        status: "Issued",
        workDescription: "Demolish an existing detached dwelling.",
        buildingType: "Single Detached House",
        constructionValue: "25000.00",
        unitsAdded: -1,
        addressId: ids.addresses.detached,
        neighbourhoodId: ids.neighbourhoods.westmount,
        sourceUpdatedAt: timestamp("2025-01-17T18:15:00.000Z"),
      },
      {
        id: ids.permitEvents.detached,
        rawRecordId: ids.rawRecords.detached,
        sourceRecordIdentifier: "SYNTH-BLD-0002",
        sourceDataset: "building",
        permitNumber: "SEED-BLD-0002",
        permitType: "Building Permit",
        permitSubtype: "New Construction",
        applicationDate: date("2025-02-03"),
        issueDate: date("2025-03-10"),
        status: "Issued",
        workDescription: "Construct a new single detached dwelling with an attached garage.",
        buildingType: "Single Detached House",
        constructionValue: "485000.00",
        unitsAdded: 1,
        addressId: ids.addresses.detached,
        neighbourhoodId: ids.neighbourhoods.westmount,
        sourceUpdatedAt: timestamp("2025-03-10T20:30:00.000Z"),
      },
      {
        id: ids.permitEvents.semiDetached,
        rawRecordId: ids.rawRecords.semiDetached,
        sourceRecordIdentifier: "SYNTH-DEV-0003",
        sourceDataset: "development",
        permitNumber: "SEED-DEV-0003",
        permitType: "Development Permit",
        permitSubtype: "New Residential",
        applicationDate: date("2025-03-12"),
        issueDate: date("2025-04-21"),
        status: "Approved",
        workDescription: "Construct a new semi-detached dwelling with two principal units.",
        buildingType: "Semi-detached House",
        constructionValue: "760000.00",
        unitsAdded: 2,
        addressId: ids.addresses.semiDetached,
        neighbourhoodId: ids.neighbourhoods.bonnieDoon,
        sourceUpdatedAt: timestamp("2025-04-21T16:45:00.000Z"),
      },
      {
        id: ids.permitEvents.gardenSuite,
        rawRecordId: ids.rawRecords.gardenSuite,
        sourceRecordIdentifier: "SYNTH-BLD-0004",
        sourceDataset: "building",
        permitNumber: "SEED-BLD-0004",
        permitType: "Building Permit",
        permitSubtype: "Garden Suite",
        applicationDate: date("2025-04-08"),
        issueDate: date("2025-05-14"),
        status: "Issued",
        workDescription: "Construct a detached garden suite above a rear garage.",
        buildingType: "Garden Suite",
        constructionValue: "215000.00",
        unitsAdded: 1,
        addressId: ids.addresses.gardenSuite,
        neighbourhoodId: ids.neighbourhoods.ritchie,
        sourceUpdatedAt: timestamp("2025-05-14T19:00:00.000Z"),
      },
      {
        id: ids.permitEvents.renovation,
        rawRecordId: ids.rawRecords.renovation,
        sourceRecordIdentifier: "SYNTH-BLD-0005",
        sourceDataset: "building",
        permitNumber: "SEED-BLD-0005",
        permitType: "Building Permit",
        permitSubtype: "Alteration",
        applicationDate: date("2025-05-02"),
        issueDate: date("2025-05-28"),
        status: "Issued",
        workDescription: "Interior renovation and kitchen alteration; no new dwelling units.",
        buildingType: "Single Detached House",
        constructionValue: "65000.00",
        unitsAdded: 0,
        addressId: ids.addresses.renovation,
        neighbourhoodId: ids.neighbourhoods.highlands,
        sourceUpdatedAt: timestamp("2025-05-28T17:20:00.000Z"),
      },
    ] as const;

    for (const fixture of permitFixtures) {
      const rawPayload = {
        synthetic: true,
        source_record_id: fixture.sourceRecordIdentifier,
        permit_number: fixture.permitNumber,
        permit_type: fixture.permitType,
        permit_subtype: fixture.permitSubtype,
        status: fixture.status,
        description: fixture.workDescription,
        building_type: fixture.buildingType,
        construction_value: fixture.constructionValue,
        units_added: fixture.unitsAdded,
      };

      await tx.rawPermitRecord.upsert({
        where: {
          sourceProvider_sourceRecordIdentifier: {
            sourceProvider,
            sourceRecordIdentifier: fixture.sourceRecordIdentifier,
          },
        },
        update: {
          payload: rawPayload,
          payloadChecksum: checksum(rawPayload),
          sourceUpdatedAt: fixture.sourceUpdatedAt,
          processingStatus: RawRecordStatus.PROCESSED,
          processingError: null,
          lastImportedAt: fixture.sourceUpdatedAt,
        },
        create: {
          id: fixture.rawRecordId,
          sourceProvider,
          sourceRecordIdentifier: fixture.sourceRecordIdentifier,
          payload: rawPayload,
          payloadChecksum: checksum(rawPayload),
          sourceUpdatedAt: fixture.sourceUpdatedAt,
          processingStatus: RawRecordStatus.PROCESSED,
          firstImportedAt: fixture.sourceUpdatedAt,
          lastImportedAt: fixture.sourceUpdatedAt,
        },
      });

      const { id, rawRecordId, sourceRecordIdentifier, ...permitValues } = fixture;

      await tx.permitEvent.upsert({
        where: {
          sourceProvider_sourceRecordIdentifier: {
            sourceProvider,
            sourceRecordIdentifier,
          },
        },
        update: {
          ...permitValues,
          rawRecordId,
          rawSourcePayload: rawPayload,
          importedAt: fixture.sourceUpdatedAt,
        },
        create: {
          id,
          sourceProvider,
          sourceRecordIdentifier,
          rawRecordId,
          rawSourcePayload: rawPayload,
          importedAt: fixture.sourceUpdatedAt,
          ...permitValues,
        },
      });
    }

    const projects = [
      {
        id: ids.projects.detached,
        projectKey: "seed:99901-127-street-nw:2025-detached",
        addressId: ids.addresses.detached,
        neighbourhoodId: ids.neighbourhoods.westmount,
        title: "Synthetic Westmount detached infill",
        category: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
        computedCategory: ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
        currentStage: ProjectStage.BUILDING_PERMIT,
        computedStage: ProjectStage.BUILDING_PERMIT,
        earliestEventDate: date("2025-01-17"),
        latestEventDate: date("2025-03-10"),
        infillStartDate: date("2025-01-17"),
        latestInfillActivityDate: date("2025-03-10"),
        estimatedUnits: 1,
        estimatedConstructionValue: "485000.00",
        marketListingStatus: MarketListingStatus.POSSIBLE_MATCH,
        infillConfidence: 90,
        confidenceExplanation: {
          summary: "Demolition followed by a new detached dwelling permit.",
          score: 90,
          factors: [
            { rule: "demolition_at_same_address", points: 20 },
            { rule: "new_residential_construction", points: 30 },
            { rule: "new_dwelling_language", points: 10 },
            { rule: "recognized_residential_building_type", points: 10 },
            { rule: "construction_value_threshold", points: 5 },
            { rule: "related_events_and_timing", points: 15 },
          ],
        },
        reviewStatus: ReviewStatus.CONFIRMED,
        marketComparison: {
          synthetic: true,
          summary: "Fixture-only example of a possible future resale signal.",
          sources: [],
        },
      },
      {
        id: ids.projects.semiDetached,
        projectKey: "seed:99902-88-avenue-nw:2025-semi-detached",
        addressId: ids.addresses.semiDetached,
        neighbourhoodId: ids.neighbourhoods.bonnieDoon,
        title: "Synthetic Bonnie Doon semi-detached infill",
        category: ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
        computedCategory: ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
        currentStage: ProjectStage.DEVELOPMENT_PERMIT,
        computedStage: ProjectStage.DEVELOPMENT_PERMIT,
        earliestEventDate: date("2025-03-12"),
        latestEventDate: date("2025-04-21"),
        infillStartDate: date("2025-03-12"),
        latestInfillActivityDate: date("2025-04-21"),
        estimatedUnits: 2,
        estimatedConstructionValue: "760000.00",
        marketListingStatus: MarketListingStatus.NOT_CHECKED,
        infillConfidence: 80,
        confidenceExplanation: {
          summary: "New semi-detached construction adding two units.",
          score: 80,
          factors: [
            { rule: "new_residential_construction", points: 30 },
            { rule: "new_dwelling_language", points: 10 },
            { rule: "two_or_more_units", points: 10 },
            { rule: "recognized_residential_building_type", points: 10 },
            { rule: "construction_value_threshold", points: 5 },
          ],
        },
        reviewStatus: ReviewStatus.CONFIRMED,
        marketComparison: Prisma.DbNull,
      },
      {
        id: ids.projects.gardenSuite,
        projectKey: "seed:99903-76-avenue-nw:2025-garden-suite",
        addressId: ids.addresses.gardenSuite,
        neighbourhoodId: ids.neighbourhoods.ritchie,
        title: "Synthetic Ritchie garden suite",
        category: ProjectCategory.PROBABLE_GARDEN_SUITE,
        computedCategory: ProjectCategory.PROBABLE_GARDEN_SUITE,
        currentStage: ProjectStage.BUILDING_PERMIT,
        computedStage: ProjectStage.BUILDING_PERMIT,
        earliestEventDate: date("2025-04-08"),
        latestEventDate: date("2025-05-14"),
        infillStartDate: date("2025-04-08"),
        latestInfillActivityDate: date("2025-05-14"),
        estimatedUnits: 1,
        estimatedConstructionValue: "215000.00",
        marketListingStatus: MarketListingStatus.NOT_CHECKED,
        infillConfidence: 75,
        confidenceExplanation: {
          summary: "A permit explicitly describes a new garden suite.",
          score: 75,
          factors: [
            { rule: "new_residential_construction", points: 30 },
            { rule: "new_dwelling_language", points: 10 },
            { rule: "recognized_residential_building_type", points: 10 },
            { rule: "construction_value_threshold", points: 5 },
          ],
        },
        reviewStatus: ReviewStatus.CONFIRMED,
        marketComparison: Prisma.DbNull,
      },
      {
        id: ids.projects.renovation,
        projectKey: "seed:99904-112-avenue-nw:2025-renovation",
        addressId: ids.addresses.renovation,
        neighbourhoodId: ids.neighbourhoods.highlands,
        title: "Synthetic Highlands renovation",
        category: ProjectCategory.RENOVATION_OR_ADDITION,
        computedCategory: ProjectCategory.RENOVATION_OR_ADDITION,
        currentStage: ProjectStage.BUILDING_PERMIT,
        computedStage: ProjectStage.BUILDING_PERMIT,
        earliestEventDate: date("2025-05-02"),
        latestEventDate: date("2025-05-28"),
        infillStartDate: date("2025-05-02"),
        latestInfillActivityDate: date("2025-05-28"),
        estimatedUnits: 0,
        estimatedConstructionValue: "65000.00",
        marketListingStatus: MarketListingStatus.NOT_CHECKED,
        infillConfidence: 10,
        confidenceExplanation: {
          summary: "Renovation-only language and no added dwelling units.",
          score: 10,
          factors: [{ rule: "renovation_only_language", points: -25 }],
        },
        reviewStatus: ReviewStatus.CONFIRMED,
        marketComparison: Prisma.DbNull,
      },
    ] as const;

    for (const project of projects) {
      const { id, projectKey, ...values } = project;

      await tx.project.upsert({
        where: { projectKey },
        update: values,
        create: { id, projectKey, ...values },
      });
    }

    const projectEvents = [
      {
        projectId: ids.projects.detached,
        permitEventId: ids.permitEvents.demolition,
        eventDate: date("2025-01-17"),
        matchReason: { strategy: "normalized_address_key", synthetic: true },
      },
      {
        projectId: ids.projects.detached,
        permitEventId: ids.permitEvents.detached,
        eventDate: date("2025-03-10"),
        matchReason: { strategy: "normalized_address_key", synthetic: true },
      },
      {
        projectId: ids.projects.semiDetached,
        permitEventId: ids.permitEvents.semiDetached,
        eventDate: date("2025-04-21"),
        matchReason: { strategy: "normalized_address_key", synthetic: true },
      },
      {
        projectId: ids.projects.gardenSuite,
        permitEventId: ids.permitEvents.gardenSuite,
        eventDate: date("2025-05-14"),
        matchReason: { strategy: "normalized_address_key", synthetic: true },
      },
      {
        projectId: ids.projects.renovation,
        permitEventId: ids.permitEvents.renovation,
        eventDate: date("2025-05-28"),
        matchReason: { strategy: "normalized_address_key", synthetic: true },
      },
    ] as const;

    for (const projectEvent of projectEvents) {
      await tx.projectEvent.upsert({
        where: { permitEventId: projectEvent.permitEventId },
        update: projectEvent,
        create: projectEvent,
      });
    }

    await tx.user.upsert({
      where: { normalizedEmail: adminEmail },
      update: {
        email: adminEmail,
        name: "Local Admin",
        role: UserRole.ADMIN,
        isActive: true,
      },
      create: {
        id: ids.users.admin,
        email: adminEmail,
        normalizedEmail: adminEmail,
        name: "Local Admin",
        passwordHash: adminPasswordHash,
        role: UserRole.ADMIN,
      },
    });

    await tx.user.upsert({
      where: { normalizedEmail: userEmail },
      update: {
        email: userEmail,
        name: "Sample User",
        role: UserRole.USER,
        isActive: true,
      },
      create: {
        id: ids.users.standard,
        email: userEmail,
        normalizedEmail: userEmail,
        name: "Sample User",
        passwordHash: userPasswordHash,
        role: UserRole.USER,
      },
    });

    await tx.savedSearch.upsert({
      where: {
        userId_name: {
          userId: ids.users.standard,
          name: "High-confidence infill watch",
        },
      },
      update: {
        projectCategories: [
          ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
          ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
          ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
          ProjectCategory.PROBABLE_GARDEN_SUITE,
        ],
        minConfidenceScore: 65,
        projectStages: [
          ProjectStage.DEVELOPMENT_PERMIT,
          ProjectStage.BUILDING_PERMIT,
          ProjectStage.CONSTRUCTION,
        ],
        alertFrequency: AlertFrequency.DAILY,
        isActive: true,
      },
      create: {
        id: ids.savedSearch,
        userId: ids.users.standard,
        name: "High-confidence infill watch",
        projectCategories: [
          ProjectCategory.PROBABLE_NEW_DETACHED_INFILL,
          ProjectCategory.PROBABLE_NEW_DETACHED_INFILL_FOR_RESALE,
          ProjectCategory.PROBABLE_SEMI_DETACHED_INFILL,
          ProjectCategory.PROBABLE_GARDEN_SUITE,
        ],
        minConfidenceScore: 65,
        projectStages: [
          ProjectStage.DEVELOPMENT_PERMIT,
          ProjectStage.BUILDING_PERMIT,
          ProjectStage.CONSTRUCTION,
        ],
        alertFrequency: AlertFrequency.DAILY,
      },
    });

    for (const neighbourhoodId of [
      ids.neighbourhoods.westmount,
      ids.neighbourhoods.bonnieDoon,
      ids.neighbourhoods.ritchie,
    ]) {
      await tx.savedSearchNeighbourhood.upsert({
        where: {
          savedSearchId_neighbourhoodId: {
            savedSearchId: ids.savedSearch,
            neighbourhoodId,
          },
        },
        update: {},
        create: {
          savedSearchId: ids.savedSearch,
          neighbourhoodId,
        },
      });
    }
  });

  console.info(
    `Seed complete: synthetic permits, four projects, and users ${adminEmail} / ${userEmail}.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error("Database seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
