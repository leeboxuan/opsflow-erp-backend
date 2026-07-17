import { JobType, TripDocumentType } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService per-container completion requirements", () => {
  const tenantId = "tenant-1";
  const jobId = "job-1";
  const tripId = "trip-1";
  const driverUserId = "driver-1";
  const items = [
    { id: "item-a", itemCode: "TLLU1234567", sealNo: "SA" },
    { id: "item-b", itemCode: "MSCU7654321", sealNo: "SB" },
    { id: "item-c", itemCode: "OOLU1111111", sealNo: "SC" },
  ];

  const ongoingTrip = {
    id: tripId,
    tenantId,
    jobId,
    status: "ONGOING",
    assignedDriverUserId: driverUserId,
    trailerNumber: "TRD1234A",
    trailerLastLocationCode: null,
    plannedStartAt: new Date("2026-04-30T08:00:00.000Z"),
    createdAt: new Date("2026-04-30T08:00:00.000Z"),
  };

  const baseDocuments = [
    {
      type: TripDocumentType.DELIVERY_DO,
      jobItemId: null,
      isActive: true,
      signedAt: new Date(),
      isSigned: true,
    },
    {
      type: TripDocumentType.POD_PHOTO,
      jobItemId: null,
      isActive: true,
      signedAt: null,
      isSigned: false,
    },
  ];

  const itemPhoto = (
    type: typeof TripDocumentType.CONTAINER_PHOTO | typeof TripDocumentType.SEAL_PHOTO,
    jobItemId: string,
    isActive = true,
  ) => ({
    type,
    jobItemId,
    isActive,
    signedAt: null,
    isSigned: false,
  });

  function completePhotos(itemIds: string[]) {
    return itemIds.flatMap((jobItemId) => [
      itemPhoto(TripDocumentType.CONTAINER_PHOTO, jobItemId),
      itemPhoto(TripDocumentType.SEAL_PHOTO, jobItemId),
    ]);
  }

  function makePrisma(options?: {
    currentItems?: typeof items;
    documents?: Array<{
      type: TripDocumentType;
      jobItemId: string | null;
      isActive: boolean;
      signedAt: Date | null;
      isSigned: boolean;
    }>;
    openTrips?: number;
    hasTrailerEndPhoto?: boolean;
  }) {
    const tripUpdate = jest.fn();
    const currentItems = options?.currentItems ?? [items[0]];
    const documents = options?.documents ?? baseDocuments;
    const openTrips =
      options?.openTrips === 1
        ? [
            {
              id: tripId,
              plannedStartAt: ongoingTrip.plannedStartAt,
              createdAt: ongoingTrip.createdAt,
            },
          ]
        : [];

    return {
      prisma: {
        tenant: {
          findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
        },
        job: {
          findFirst: jest.fn().mockResolvedValue({
            id: jobId,
            status: "ONGOING",
            jobType: JobType.IMPORT,
            documents: [],
          }),
        },
        jobItem: {
          findMany: jest.fn().mockResolvedValue(currentItems),
        },
        trip: {
          findFirst: jest.fn().mockResolvedValue(ongoingTrip),
          findMany: jest.fn().mockResolvedValue(openTrips),
        },
        tripDocument: {
          findMany: jest.fn().mockResolvedValue(documents),
          findFirst: jest.fn().mockResolvedValue(
            options?.hasTrailerEndPhoto ? { id: "trailer-end" } : null,
          ),
        },
        masterTrailerLocation: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        $transaction: jest.fn(async (callback: (tx: unknown) => unknown) =>
          callback({
            trip: { update: tripUpdate },
            tripDocument: { create: jest.fn() },
          }),
        ),
      },
      tripUpdate,
    };
  }

  function makeService(prisma: ReturnType<typeof makePrisma>["prisma"]) {
    return new DriverJobsService(
      prisma as never,
      { log: jest.fn() } as never,
      { getClient: jest.fn() } as never,
    );
  }

  it("returns one container with neither photo", async () => {
    const { prisma } = makePrisma();
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.containerDocumentation).toEqual([
      expect.objectContaining({
        jobItemId: "item-a",
        containerNumber: "TLLU1234567",
        sealNumber: "SA",
        hasContainerPhoto: false,
        hasSealPhoto: false,
        missing: [
          TripDocumentType.CONTAINER_PHOTO,
          TripDocumentType.SEAL_PHOTO,
        ],
      }),
    ]);
    expect(result.missingContainerDocumentation).toHaveLength(1);
    expect(result.canComplete).toBe(false);
  });

  it.each([
    {
      name: "only container photo",
      document: itemPhoto(TripDocumentType.CONTAINER_PHOTO, "item-a"),
      missing: TripDocumentType.SEAL_PHOTO,
    },
    {
      name: "only seal photo",
      document: itemPhoto(TripDocumentType.SEAL_PHOTO, "item-a"),
      missing: TripDocumentType.CONTAINER_PHOTO,
    },
  ])("reports one container with $name", async ({ document, missing }) => {
    const { prisma } = makePrisma({
      documents: [...baseDocuments, document],
    });
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.containerDocumentation[0].missing).toEqual([missing]);
    expect(result.missingDocuments).toContain(missing);
    expect(result.canComplete).toBe(false);
  });

  it("allows one container with both photos", async () => {
    const { prisma } = makePrisma({
      documents: [...baseDocuments, ...completePhotos(["item-a"])],
    });
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.containerDocumentation[0].missing).toEqual([]);
    expect(result.missingContainerDocumentation).toEqual([]);
    expect(result.canComplete).toBe(true);
  });

  it("allows three containers with all six linked photos", async () => {
    const { prisma } = makePrisma({
      currentItems: items,
      documents: [...baseDocuments, ...completePhotos(items.map((item) => item.id))],
    });
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.containerDocumentation).toHaveLength(3);
    expect(result.missingContainerDocumentation).toEqual([]);
    expect(result.canComplete).toBe(true);
  });

  it("reports the exact row when one of three seal photos is missing", async () => {
    const documents = [
      ...baseDocuments,
      ...completePhotos(items.map((item) => item.id)),
    ].filter(
      (document) =>
        !(
          document.type === TripDocumentType.SEAL_PHOTO
          && document.jobItemId === "item-b"
        ),
    );
    const { prisma } = makePrisma({ currentItems: items, documents });
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.missingContainerDocumentation).toEqual([
      expect.objectContaining({
        jobItemId: "item-b",
        containerNumber: "MSCU7654321",
        missing: [TripDocumentType.SEAL_PHOTO],
      }),
    ]);
    expect(result.canComplete).toBe(false);
  });

  it("does not let three photos linked to one item satisfy other items", async () => {
    const duplicatePhotos = [
      itemPhoto(TripDocumentType.CONTAINER_PHOTO, "item-a"),
      itemPhoto(TripDocumentType.CONTAINER_PHOTO, "item-a"),
      itemPhoto(TripDocumentType.CONTAINER_PHOTO, "item-a"),
      itemPhoto(TripDocumentType.SEAL_PHOTO, "item-a"),
    ];
    const { prisma } = makePrisma({
      currentItems: items,
      documents: [...baseDocuments, ...duplicatePhotos],
    });
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.missingContainerDocumentation.map((row) => row.jobItemId)).toEqual([
      "item-b",
      "item-c",
    ]);
    expect(result.canComplete).toBe(false);
  });

  it("does not count an inactive photo", async () => {
    const { prisma } = makePrisma({
      documents: [
        ...baseDocuments,
        itemPhoto(TripDocumentType.CONTAINER_PHOTO, "item-a", false),
        itemPhoto(TripDocumentType.SEAL_PHOTO, "item-a"),
      ],
    });
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.containerDocumentation[0].missing).toEqual([
      TripDocumentType.CONTAINER_PHOTO,
    ]);
  });

  it("removed containers no longer block and their documents do not count", async () => {
    const { prisma } = makePrisma({
      currentItems: [items[0]],
      documents: [
        ...baseDocuments,
        ...completePhotos(["item-a"]),
        itemPhoto(TripDocumentType.CONTAINER_PHOTO, "removed-item"),
      ],
    });
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.containerDocumentation.map((row) => row.jobItemId)).toEqual([
      "item-a",
    ]);
    expect(result.canComplete).toBe(true);
  });

  it("retains association when a container number changes under the same item id", async () => {
    const editedItem = {
      ...items[0],
      itemCode: "TLLU9999999",
    };
    const { prisma } = makePrisma({
      currentItems: [editedItem],
      documents: [...baseDocuments, ...completePhotos(["item-a"])],
    });
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.containerDocumentation[0]).toEqual(
      expect.objectContaining({
        jobItemId: "item-a",
        containerNumber: "TLLU9999999",
        missing: [],
      }),
    );
    expect(result.canComplete).toBe(true);
  });

  it("combines container status with existing DO/POD and trailer requirements", async () => {
    const unsignedDo = {
      ...baseDocuments[0],
      signedAt: null,
      isSigned: false,
    };
    const { prisma } = makePrisma({
      documents: [
        unsignedDo,
        baseDocuments[1],
        ...completePhotos(["item-a"]),
      ],
      openTrips: 1,
      hasTrailerEndPhoto: false,
    });
    const result = await makeService(prisma).getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(result.missingContainerDocumentation).toEqual([]);
    expect(result.missingDocuments).toContain(TripDocumentType.DELIVERY_DO);
    expect(result.missingTrailerCheckoutFields).toContain("trailerEndPhoto");
    expect(result.canComplete).toBe(false);
  });

  it("completeTrip independently rejects a stale-client completion attempt", async () => {
    const documents = [
      ...baseDocuments,
      ...completePhotos(["item-a"]),
      itemPhoto(TripDocumentType.CONTAINER_PHOTO, "item-b"),
    ];
    const { prisma, tripUpdate } = makePrisma({
      currentItems: [items[0], items[1]],
      documents,
    });
    const service = makeService(prisma);

    await expect(
      service.completeTrip(tenantId, jobId, tripId, driverUserId),
    ).rejects.toThrow(
      "Container documentation is incomplete for MSCU7654321.",
    );
    expect(tripUpdate).not.toHaveBeenCalled();
  });
});
