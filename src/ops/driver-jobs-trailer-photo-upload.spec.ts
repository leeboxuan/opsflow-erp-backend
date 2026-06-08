import { TripDocumentType } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService.uploadTripDocumentForDriver trailer photos", () => {
  const tenantId = "tenant-1";
  const jobId = "job-1";
  const tripId = "trip-1";
  const driverUserId = "driver-1";

  const imageFile = {
    buffer: Buffer.from([1, 2, 3]),
    mimetype: "image/jpeg",
    originalname: "trailer.jpg",
    size: 3,
  } as Express.Multer.File;

  function makePrisma() {
    return {
      job: { findFirst: jest.fn().mockResolvedValue({ id: jobId, status: "ONGOING" }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: tripId, assignedDriverUserId: driverUserId }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { findUnique: jest.fn().mockResolvedValue({ id: driverUserId, name: "Driver A", email: "d@test.com" }) },
      tripDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "doc-new",
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            uploadedBy: null,
          }),
        ),
        findFirst: jest.fn().mockResolvedValue({ id: "doc-end" }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
    };
  }

  function makeSvc(prisma: ReturnType<typeof makePrisma>) {
    const supabaseService = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: jest.fn().mockResolvedValue({ error: null }),
            createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: "https://signed" } }),
          }),
        },
      }),
    };
    return new DriverJobsService(prisma as any, { log: jest.fn() } as any, supabaseService as any);
  }

  it.each([
    TripDocumentType.TRAILER_START_PHOTO,
    TripDocumentType.TRAILER_END_PHOTO,
  ])("uploads %s and saves active TripDocument", async (type) => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);

    await svc.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      type,
      imageFile,
    );

    expect(prisma.tripDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type,
          tripId,
          tenantId,
          isActive: true,
        }),
      }),
    );
  });

  it("deactivates prior active trailer end photo when uploading a new one", async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);

    await svc.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      TripDocumentType.TRAILER_END_PHOTO,
      imageFile,
    );

    expect(prisma.tripDocument.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        tripId,
        type: TripDocumentType.TRAILER_END_PHOTO,
        isActive: true,
      },
      data: { isActive: false },
    });
  });

  it("rejects unsupported trip document types with logging context", async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(
      svc.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        TripDocumentType.TRAILER_PARKING_PHOTO,
        imageFile,
      ),
    ).rejects.toThrow("Unsupported trip document type");

    expect(warnSpy).toHaveBeenCalledWith(
      "driver_trip_doc_upload_rejected",
      expect.objectContaining({
        receivedType: TripDocumentType.TRAILER_PARKING_PHOTO,
        tripId,
        userId: driverUserId,
      }),
    );
    warnSpy.mockRestore();
  });

  it("completion requirements treat active TRAILER_END_PHOTO as satisfying trailerEndPhoto", async () => {
    const prisma = makePrisma();
    const publishedTrip = {
      id: tripId,
      tenantId,
      jobId,
      status: "ONGOING",
      assignedDriverUserId: driverUserId,
      trailerNumber: "TR666D",
      trailerLastLocationCode: "GUL-7",
      plannedStartAt: new Date("2026-04-30T08:00:00.000Z"),
      createdAt: new Date("2026-04-30T08:00:00.000Z"),
    };
    prisma.trip.findFirst.mockResolvedValue(publishedTrip);
    prisma.trip.findMany.mockResolvedValue([
      {
        id: tripId,
        plannedStartAt: new Date("2026-04-30T08:00:00.000Z"),
        createdAt: new Date("2026-04-30T08:00:00.000Z"),
      },
    ]);
    prisma.masterTrailerLocation.findMany.mockResolvedValue([
      { id: "loc1", code: "GUL-7", name: "7 Gul Circle" },
    ]);

    const svc = makeSvc(prisma);
    const res = await svc.getTripCompletionRequirements(tenantId, jobId, tripId, driverUserId);

    expect(prisma.tripDocument.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tripId,
          isActive: true,
          type: TripDocumentType.TRAILER_END_PHOTO,
        }),
      }),
    );
    expect(res.missingTrailerCheckoutFields).not.toContain("trailerEndPhoto");
    expect(res.canComplete).toBe(true);
  });
});
