import { TripDocumentType } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService trip completion requirements", () => {
  const tenantId = "tenant-1";
  const jobId = "job-1";
  const tripId = "trip-1";
  const driverUserId = "driver-1";

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

  function signedDeliveryDo() {
    return {
      type: TripDocumentType.DELIVERY_DO,
      signedAt: new Date(),
      isSigned: true,
    };
  }

  function podPhoto() {
    return {
      type: TripDocumentType.POD_PHOTO,
      signedAt: null,
      isSigned: false,
    };
  }

  function containerPhoto() {
    return {
      type: TripDocumentType.CONTAINER_PHOTO,
      signedAt: null,
      isSigned: false,
    };
  }

  function sealPhoto() {
    return {
      type: TripDocumentType.SEAL_PHOTO,
      signedAt: null,
      isSigned: false,
    };
  }

  function baseCompletionDocs() {
    return [signedDeliveryDo(), podPhoto(), containerPhoto(), sealPhoto()];
  }

  function makePrisma(completionDocs: Array<{
    type: TripDocumentType;
    signedAt: Date | null;
    isSigned: boolean;
  }>, opts?: { hasTrailerEndPhoto?: boolean; openTrips?: number }) {
    const tripDocumentCreate = jest.fn();
    const tripUpdate = jest.fn();
    const tx = {
      trip: { update: tripUpdate },
      tripDocument: { create: tripDocumentCreate },
    };
    const openTrips =
      opts?.openTrips === 1
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
        tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
        job: {
          findFirst: jest.fn().mockResolvedValue({ id: jobId, status: "ONGOING", documents: [] }),
          update: jest.fn(),
        },
        trip: {
          findFirst: jest.fn().mockResolvedValue(ongoingTrip),
          findMany: jest.fn().mockResolvedValue(openTrips),
        },
        tripDocument: {
          findMany: jest.fn().mockResolvedValue(completionDocs),
          findFirst: jest.fn().mockResolvedValue(
            opts?.hasTrailerEndPhoto ? { id: "doc-end" } : null,
          ),
        },
        masterTrailerLocation: {
          findFirst: jest.fn().mockResolvedValue(null),
          findMany: jest.fn().mockResolvedValue([]),
        },
        user: { findUnique: jest.fn().mockResolvedValue({ id: driverUserId }) },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      },
      tripUpdate,
    };
  }

  function makeSvc(prisma: ReturnType<typeof makePrisma>["prisma"]) {
    return new DriverJobsService(
      prisma as any,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
  }

  it("returns canComplete false and missing POD_PHOTO when photo documentation is absent", async () => {
    const { prisma } = makePrisma([signedDeliveryDo(), containerPhoto(), sealPhoto()]);
    const svc = makeSvc(prisma);

    const res = await svc.getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(res.canComplete).toBe(false);
    expect(res.missingDocuments).toContain("POD_PHOTO");
    expect(res.missingBaseCompletionDocuments).toContain("POD_PHOTO");
  });

  it("reports missing CONTAINER_PHOTO and SEAL_PHOTO when neither is uploaded", async () => {
    const { prisma } = makePrisma([signedDeliveryDo(), podPhoto()]);
    const svc = makeSvc(prisma);

    const res = await svc.getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(res.canComplete).toBe(false);
    expect(res.missingDocuments).toEqual(
      expect.arrayContaining(["CONTAINER_PHOTO", "SEAL_PHOTO"]),
    );
  });

  it("reports missing SEAL_PHOTO when only container photo uploaded", async () => {
    const { prisma } = makePrisma([signedDeliveryDo(), podPhoto(), containerPhoto()]);
    const svc = makeSvc(prisma);

    const res = await svc.getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(res.canComplete).toBe(false);
    expect(res.missingDocuments).toContain("SEAL_PHOTO");
    expect(res.missingDocuments).not.toContain("CONTAINER_PHOTO");
  });

  it("reports missing CONTAINER_PHOTO when only seal photo uploaded", async () => {
    const { prisma } = makePrisma([signedDeliveryDo(), podPhoto(), sealPhoto()]);
    const svc = makeSvc(prisma);

    const res = await svc.getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(res.canComplete).toBe(false);
    expect(res.missingDocuments).toContain("CONTAINER_PHOTO");
    expect(res.missingDocuments).not.toContain("SEAL_PHOTO");
  });

  it("treats inactive/deleted container photo as missing", async () => {
    // Query already filters isActive=true; inactive docs are simply absent from the result set.
    const { prisma } = makePrisma([signedDeliveryDo(), podPhoto(), sealPhoto()]);
    const svc = makeSvc(prisma);

    const res = await svc.getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );

    expect(res.missingDocuments).toContain("CONTAINER_PHOTO");
    expect(res.canComplete).toBe(false);
  });

  it("rejects complete trip API when photo documentation is missing", async () => {
    const { prisma } = makePrisma([signedDeliveryDo(), containerPhoto(), sealPhoto()]);
    const svc = makeSvc(prisma);

    await expect(
      svc.completeTrip(tenantId, jobId, tripId, driverUserId),
    ).rejects.toThrow(/Missing required trip documents: POD_PHOTO/);
  });

  it("rejects complete trip when container or seal photo is missing", async () => {
    const { prisma } = makePrisma([signedDeliveryDo(), podPhoto(), containerPhoto()]);
    const svc = makeSvc(prisma);

    await expect(
      svc.completeTrip(tenantId, jobId, tripId, driverUserId),
    ).rejects.toThrow(/Missing required trip documents:.*SEAL_PHOTO/);
  });

  it("rejects complete trip when delivery DO is unsigned", async () => {
    const { prisma } = makePrisma([
      podPhoto(),
      containerPhoto(),
      sealPhoto(),
      {
        type: TripDocumentType.DELIVERY_DO,
        signedAt: null,
        isSigned: false,
      },
    ]);
    const svc = makeSvc(prisma);

    await expect(
      svc.completeTrip(tenantId, jobId, tripId, driverUserId),
    ).rejects.toThrow(/Missing required trip documents: DELIVERY_DO/);
  });

  it("rejects complete trip when trailer end photo is required but missing", async () => {
    const { prisma } = makePrisma(baseCompletionDocs(), {
      openTrips: 1,
      hasTrailerEndPhoto: false,
    });
    const svc = makeSvc(prisma);

    await expect(
      svc.completeTrip(tenantId, jobId, tripId, driverUserId),
    ).rejects.toThrow("Missing trailer checkout fields: trailerEndPhoto");
  });

  it("allows complete when photo, signed DO, container/seal, and trailer end photo exist even without parking code", async () => {
    const { prisma, tripUpdate } = makePrisma(baseCompletionDocs(), {
      openTrips: 1,
      hasTrailerEndPhoto: true,
    });
    const svc = makeSvc(prisma);
    jest.spyOn(svc, "getOneForDriver").mockResolvedValue({ trips: [{ id: tripId }] } as any);

    const res = await svc.getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );
    expect(res.missingTrailerCheckoutFields).toContain("trailerParkingLocationCode");
    expect(res.canComplete).toBe(true);

    await expect(
      svc.completeTrip(tenantId, jobId, tripId, driverUserId),
    ).resolves.toBeTruthy();
    expect(tripUpdate).toHaveBeenCalled();
  });

  it("succeeds when all required completion documents are satisfied", async () => {
    const { prisma, tripUpdate } = makePrisma(baseCompletionDocs());
    const svc = makeSvc(prisma);
    jest.spyOn(svc, "getOneForDriver").mockResolvedValue({ trips: [{ id: tripId }] } as any);

    const res = await svc.getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );
    expect(res.canComplete).toBe(true);
    expect(res.missingDocuments).toEqual([]);

    await expect(
      svc.completeTrip(tenantId, jobId, tripId, driverUserId),
    ).resolves.toBeTruthy();
    expect(tripUpdate).toHaveBeenCalled();
  });
});
