import { TripStatus } from "@prisma/client";
import { DRIVER_TRIP_SEQUENCE_BLOCKING_ERROR } from "./driver-trip-sequence.helpers";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService startTripWithTrailer sequence gate", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const trip1 = "trip-1";
  const trip2 = "trip-2";
  const driverUserId = "driver-1";
  const day = new Date("2026-08-14T02:00:00.000Z");

  function makeSvc(earlierStatus: TripStatus) {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: jobId,
          status: "ONGOING",
          pickupDate: day,
        }),
      },
      trip: {
        count: jest.fn().mockResolvedValue(2),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: trip2,
            tenantId,
            jobId,
            status: TripStatus.PUBLISHED,
            assignedDriverUserId: driverUserId,
            plannedStartAt: day,
            startedAt: null,
            tripSequence: 2,
            jobSequence: 2,
          })
          .mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([
          {
            id: trip1,
            status: earlierStatus,
            tripSequence: 1,
            jobSequence: 1,
            plannedStartAt: day,
            createdAt: day,
            assignedDriverUserId: driverUserId,
            job: { pickupDate: day },
          },
          {
            id: trip2,
            status: TripStatus.PUBLISHED,
            tripSequence: 2,
            jobSequence: 2,
            plannedStartAt: day,
            createdAt: day,
            assignedDriverUserId: driverUserId,
            job: { pickupDate: day },
          },
        ]),
        update: jest.fn(),
      },
      chassis: {
        findFirst: jest.fn().mockResolvedValue({
          id: "chassis-1",
          tenantId,
          chassisNo: "TRL1",
          status: "ACTIVE",
          isBorrowed: false,
          borrowedFromCompany: null,
        }),
      },
      tripDocument: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      tripDocumentRequirement: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: driverUserId, name: "D", email: "d@x.com" }) },
      $transaction: jest.fn(async (cb: any) =>
        cb({
          tripDocument: { create: jest.fn() },
          trip: { update: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
        }),
      ),
    };

    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      {
        getClient: () => ({
          storage: {
            from: () => ({
              upload: jest.fn().mockResolvedValue({ error: null }),
            }),
          },
        }),
      } as any,
    );
    jest.spyOn(svc as any, "getTenantTimeZone").mockResolvedValue("Asia/Singapore");
    jest.useFakeTimers();
    jest.setSystemTime(day);
    return svc;
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  const trailerPayload = {
    chassisId: "chassis-1",
    trailerNumber: "TRL1",
    trailerPhoto: {
      buffer: Buffer.from("x"),
      mimetype: "image/jpeg",
      originalname: "t.jpg",
      size: 1,
    } as Express.Multer.File,
  };

  it("rejects starting trip 2 while trip 1 is still PUBLISHED", async () => {
    const svc = makeSvc(TripStatus.PUBLISHED);
    await expect(
      svc.startTripWithTrailer(tenantId, jobId, trip2, driverUserId, trailerPayload),
    ).rejects.toThrow(DRIVER_TRIP_SEQUENCE_BLOCKING_ERROR);
  });

  it("allows starting trip 2 after trip 1 is COMPLETED", async () => {
    const svc = makeSvc(TripStatus.COMPLETED);
    jest.spyOn(svc, "getOneForDriver").mockResolvedValue({ id: jobId } as any);
    await expect(
      svc.startTripWithTrailer(tenantId, jobId, trip2, driverUserId, trailerPayload),
    ).resolves.toBeTruthy();
  });

  it("allows starting trip 2 after trip 1 is CANCELLED", async () => {
    const svc = makeSvc(TripStatus.CANCELLED);
    jest.spyOn(svc, "getOneForDriver").mockResolvedValue({ id: jobId } as any);
    await expect(
      svc.startTripWithTrailer(tenantId, jobId, trip2, driverUserId, trailerPayload),
    ).resolves.toBeTruthy();
  });
});
