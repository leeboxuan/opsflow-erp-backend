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
    const { prisma } = makePrisma([signedDeliveryDo()]);
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

  it("rejects complete trip API when photo documentation is missing", async () => {
    const { prisma } = makePrisma([signedDeliveryDo()]);
    const svc = makeSvc(prisma);

    await expect(
      svc.completeTrip(tenantId, jobId, tripId, driverUserId),
    ).rejects.toThrow(/Missing required trip documents: POD_PHOTO/);
  });

  it("rejects complete trip when delivery DO is unsigned", async () => {
    const { prisma } = makePrisma([
      podPhoto(),
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
    const { prisma } = makePrisma([signedDeliveryDo(), podPhoto()], {
      openTrips: 1,
      hasTrailerEndPhoto: false,
    });
    const svc = makeSvc(prisma);

    await expect(
      svc.completeTrip(tenantId, jobId, tripId, driverUserId),
    ).rejects.toThrow("Missing trailer checkout fields: trailerEndPhoto");
  });

  it("allows complete when photo, signed DO, and trailer end photo exist even without parking code", async () => {
    const { prisma, tripUpdate } = makePrisma([signedDeliveryDo(), podPhoto()], {
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
    const { prisma, tripUpdate } = makePrisma([signedDeliveryDo(), podPhoto()]);
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
