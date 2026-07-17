import { TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService startTripWithTrailer date gate", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const driverUserId = "driver-1";

  function makeSvc(opts: {
    plannedStartAt: Date | null;
    pickupDate?: Date | null;
    now?: Date;
  }) {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: jobId,
          status: "ONGOING",
          pickupDate: opts.pickupDate ?? null,
        }),
      },
      trip: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          tenantId,
          jobId,
          status: TripStatus.PUBLISHED,
          assignedDriverUserId: driverUserId,
          plannedStartAt: opts.plannedStartAt,
          startedAt: null,
        }),
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn(),
      },
      tripDocument: { create: jest.fn() },
      user: { findUnique: jest.fn().mockResolvedValue({ id: driverUserId, name: "D", email: "d@x.com" }) },
      $transaction: jest.fn(async (cb: any) =>
        cb({
          tripDocument: { create: jest.fn() },
          trip: { update: jest.fn() },
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

    if (opts.now) {
      jest.spyOn(svc as any, "getTenantTimeZone").mockResolvedValue("Asia/Singapore");
      jest.useFakeTimers();
      jest.setSystemTime(opts.now);
    }

    return { svc, prisma };
  }

  afterEach(() => {
    jest.useRealTimers();
  });

  const trailerPayload = {
    trailerNumber: "TRL1",
    trailerPhoto: {
      buffer: Buffer.from("x"),
      mimetype: "image/jpeg",
      originalname: "t.jpg",
      size: 1,
    } as Express.Multer.File,
  };

  it("allows start on the scheduled day", async () => {
    const { svc } = makeSvc({
      plannedStartAt: new Date("2026-07-17T02:00:00.000Z"),
      now: new Date("2026-07-17T08:00:00.000Z"),
    });
    jest.spyOn(svc, "getOneForDriver").mockResolvedValue({ id: jobId } as any);

    await expect(
      svc.startTripWithTrailer(tenantId, jobId, tripId, driverUserId, trailerPayload),
    ).resolves.toBeTruthy();
  });

  it("rejects start before the scheduled day", async () => {
    const { svc } = makeSvc({
      plannedStartAt: new Date("2026-07-18T02:00:00.000Z"),
      now: new Date("2026-07-17T08:00:00.000Z"),
    });

    await expect(
      svc.startTripWithTrailer(tenantId, jobId, tripId, driverUserId, trailerPayload),
    ).rejects.toThrow(/cannot be started yet/);
  });

  it("rejects start after the scheduled day", async () => {
    const { svc } = makeSvc({
      plannedStartAt: new Date("2026-07-17T02:00:00.000Z"),
      now: new Date("2026-07-18T02:00:00.000Z"),
    });

    await expect(
      svc.startTripWithTrailer(tenantId, jobId, tripId, driverUserId, trailerPayload),
    ).rejects.toThrow(
      "This trip was scheduled for 17 July 2026 and can no longer be started.",
    );
  });
});

describe("DriverJobsService completeTrip is not blocked by late calendar date", () => {
  it("allows completion days after the scheduled date when docs are satisfied", async () => {
    const { TripDocumentType } = await import("@prisma/client");
    const tripId = "trip1";
    const jobId = "job1";
    const driverUserId = "driver-1";
    const tripUpdate = jest.fn();
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: jobId, status: "ONGOING", documents: [] }),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          tenantId: "t1",
          jobId,
          status: "ONGOING",
          assignedDriverUserId: driverUserId,
          trailerNumber: "T1",
          trailerLastLocationCode: null,
          plannedStartAt: new Date("2026-07-17T02:00:00.000Z"),
          createdAt: new Date("2026-07-17T02:00:00.000Z"),
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tripDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            type: TripDocumentType.DELIVERY_DO,
            signedAt: new Date(),
            isSigned: true,
          },
          { type: TripDocumentType.POD_PHOTO, signedAt: null, isSigned: false },
          { type: TripDocumentType.CONTAINER_PHOTO, signedAt: null, isSigned: false },
          { type: TripDocumentType.SEAL_PHOTO, signedAt: null, isSigned: false },
        ]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      masterTrailerLocation: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (cb: any) =>
        cb({ trip: { update: tripUpdate }, tripDocument: { create: jest.fn() } }),
      ),
    };

    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc, "getOneForDriver").mockResolvedValue({ trips: [{ id: tripId }] } as any);
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-20T10:00:00.000Z"));

    await expect(
      svc.completeTrip("t1", jobId, tripId, driverUserId),
    ).resolves.toBeTruthy();
    expect(tripUpdate).toHaveBeenCalled();

    jest.useRealTimers();
  });
});
