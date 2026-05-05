import { DriverJobsService } from "./driver-jobs.service";
import { TripDocumentType, TripStatus } from "@prisma/client";

describe("DriverJobsService wallet summary and trip photos", () => {
  it("returns monthly wallet summary from COMPLETED/DONE trips", async () => {
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip-1",
            jobId: "job-1",
            title: "Trip 1",
            status: TripStatus.COMPLETED,
            closedAt: new Date("2026-05-20T10:00:00.000Z"),
            updatedAt: new Date("2026-05-20T10:00:00.000Z"),
            driverEarningCents: 5000,
            earningLabelSnapshot: "Fixed payout",
            payoutLines: [{ totalCents: 6000 }],
            job: { internalRef: "JOB-001" },
          },
          {
            id: "trip-2",
            jobId: "job-2",
            title: "Trip 2",
            status: TripStatus.DONE,
            closedAt: null,
            updatedAt: new Date("2026-05-10T10:00:00.000Z"),
            driverEarningCents: null,
            earningLabelSnapshot: null,
            payoutLines: [{ totalCents: 7000 }, { totalCents: 500 }],
            job: { internalRef: "JOB-002" },
          },
        ]),
      },
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, {} as any);
    const res = await svc.getWalletSummaryByMonth("tenant-1", "driver-1", "2026-05");
    expect(res.month).toBe("2026-05");
    expect(res.completedTripCount).toBe(2);
    expect(res.totalCents).toBe(12500);
    expect(res.trips[0].tripId).toBe("trip-1");
    expect(res.trips[0].driverEarningCents).toBe(5000);
    expect(res.trips[1].tripId).toBe("trip-2");
    expect(res.trips[1].driverEarningCents).toBe(7500);
    const where = prisma.trip.findMany.mock.calls[0][0].where;
    expect(where.status.in).toEqual([TripStatus.COMPLETED, TripStatus.DONE]);
  });

  it("keeps OTHER as multi-active and supports image upload", async () => {
    const prisma: any = {
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job-1" }) },
      trip: { findFirst: jest.fn().mockResolvedValue({ id: "trip-1" }) },
      tripDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: "doc-1",
          type: TripDocumentType.OTHER,
          originalName: "photo.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 10,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          uploadedByUserId: "driver-1",
          uploadedByNameSnapshot: null,
          generatedBySystem: false,
          generatedSource: null,
          jobId: "job-1",
          tripId: "trip-1",
          requiresSignature: false,
          isSigned: false,
          signedAt: null,
          signedByUserId: null,
          signedByName: null,
          storageKey: "tenant/jobs/job-1/trips/trip-1/other/1.jpg",
        }),
      },
    };
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: jest.fn().mockResolvedValue({ error: null }),
            createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: "https://signed" } }),
          }),
        },
      }),
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn() } as any, supabaseService);
    const file = {
      buffer: Buffer.from([1, 2, 3]),
      mimetype: "image/jpeg",
      originalname: "photo.jpg",
      size: 3,
    } as Express.Multer.File;
    await svc.uploadTripDocumentForDriver(
      "tenant-1",
      "job-1",
      "trip-1",
      "driver-1",
      TripDocumentType.OTHER,
      file,
      false,
    );
    expect(prisma.tripDocument.updateMany).not.toHaveBeenCalled();
    expect(prisma.tripDocument.create).toHaveBeenCalled();
  });
});
