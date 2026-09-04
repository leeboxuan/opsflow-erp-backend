import { JobType, TripDocumentType } from "@prisma/client";
import {
  DriverJobsService,
  MAX_ACTIVE_CONTAINER_LINKED_PHOTOS_PER_CATEGORY,
} from "./driver-jobs.service";

describe("DriverJobsService container-linked trip document upload", () => {
  const tenantId = "tenant-1";
  const jobId = "job-1";
  const tripId = "trip-1";
  const driverUserId = "driver-1";
  const jobItemId = "item-1";
  const imageFile = {
    buffer: Buffer.from([1, 2, 3]),
    mimetype: "image/jpeg",
    originalname: "container.jpg",
    size: 3,
  } as Express.Multer.File;

  function makeContext(options?: {
    item?: { id: string } | null;
    assignedDriverUserId?: string;
    jobType?: JobType;
  }) {
    const storageUpload = jest.fn().mockResolvedValue({ error: null });
    const prisma = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: jobId,
          status: "ONGOING",
          jobType: options?.jobType ?? JobType.IMPORT,
        }),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          jobId,
          status: "ONGOING",
          assignedDriverUserId:
            options?.assignedDriverUserId ?? driverUserId,
        }),
      },
      jobItem: {
        findFirst: jest.fn().mockResolvedValue(
          options && "item" in options ? options.item : { id: jobItemId },
        ),
      },
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue(
          options && "item" in options && options.item === null
            ? []
            : [{ id: "link-1", jobItemId }],
        ),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: driverUserId,
          name: "Driver",
          email: "driver@example.com",
        }),
      },
      tripDocument: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "doc-1",
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          }),
        ),
      },
    };
    const service = new DriverJobsService(
      prisma as never,
      { log: jest.fn() } as never,
      {
        getClient: () => ({
          storage: {
            from: () => ({ upload: storageUpload }),
          },
        }),
      } as never,
    );
    return { service, prisma, storageUpload };
  }

  it.each([
    TripDocumentType.CONTAINER_PHOTO,
    TripDocumentType.SEAL_PHOTO,
  ])("requires jobItemId for %s", async (type) => {
    const { service, storageUpload } = makeContext();

    await expect(
      service.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        type,
        imageFile,
      ),
    ).rejects.toThrow(`jobItemId is required for ${type}`);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("persists the linked jobItemId and returns it", async () => {
    const { service, prisma } = makeContext();

    const result = await service.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      TripDocumentType.CONTAINER_PHOTO,
      imageFile,
      false,
      undefined,
      jobItemId,
    );

    expect(prisma.jobItem.findFirst).toHaveBeenCalledWith({
      where: { id: jobItemId, tenantId, jobId },
      select: { id: true },
    });
    expect(prisma.tripDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobItemId,
          tripId,
          type: TripDocumentType.CONTAINER_PHOTO,
        }),
      }),
    );
    expect(result.jobItemId).toBe(jobItemId);
  });

  it("appends without deactivating prior active photos for the same container slot", async () => {
    const { service, prisma } = makeContext();
    (prisma.tripDocument.count as jest.Mock).mockResolvedValue(1);

    await service.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      TripDocumentType.SEAL_PHOTO,
      imageFile,
      false,
      undefined,
      jobItemId,
    );

    expect(prisma.tripDocument.count).toHaveBeenCalledWith({
      where: {
        tenantId,
        tripId,
        jobItemId,
        type: TripDocumentType.SEAL_PHOTO,
        isActive: true,
      },
    });
    expect(prisma.tripDocument.updateMany).not.toHaveBeenCalled();
    expect(prisma.tripDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobItemId,
          type: TripDocumentType.SEAL_PHOTO,
          isActive: true,
        }),
      }),
    );
  });

  it("rejects when the per-category active photo limit is reached", async () => {
    const { service, prisma, storageUpload } = makeContext();
    (prisma.tripDocument.count as jest.Mock).mockResolvedValue(
      MAX_ACTIVE_CONTAINER_LINKED_PHOTOS_PER_CATEGORY,
    );

    await expect(
      service.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        TripDocumentType.CONTAINER_PHOTO,
        imageFile,
        false,
        undefined,
        jobItemId,
      ),
    ).rejects.toThrow(
      `At most ${MAX_ACTIVE_CONTAINER_LINKED_PHOTOS_PER_CATEGORY} active CONTAINER_PHOTO photos are allowed per container on this trip`,
    );
    expect(storageUpload).not.toHaveBeenCalled();
    expect(prisma.tripDocument.create).not.toHaveBeenCalled();
  });

  it("rejects a job item from another job", async () => {
    const { service, prisma, storageUpload } = makeContext({ item: null });

    await expect(
      service.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        TripDocumentType.CONTAINER_PHOTO,
        imageFile,
        false,
        undefined,
        "foreign-job-item",
      ),
    ).rejects.toThrow("jobItemId does not belong to this trip's job and tenant");
    expect(prisma.jobItem.findFirst).toHaveBeenCalledWith({
      where: { id: "foreign-job-item", tenantId, jobId },
      select: { id: true },
    });
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("rejects upload when jobItemId is not linked via TripJobItem", async () => {
    const { service, prisma, storageUpload } = makeContext();
    (prisma.tripJobItem.findMany as jest.Mock).mockResolvedValue([]);

    await expect(
      service.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        TripDocumentType.CONTAINER_PHOTO,
        imageFile,
        false,
        undefined,
        jobItemId,
      ),
    ).rejects.toThrow(/not linked to this trip via TripJobItem/i);
    expect(storageUpload).not.toHaveBeenCalled();
  });

  it("rejects a job item from another tenant", async () => {
    const { service, prisma } = makeContext({ item: null });

    await expect(
      service.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        TripDocumentType.SEAL_PHOTO,
        imageFile,
        false,
        undefined,
        "other-tenant-item",
      ),
    ).rejects.toThrow("jobItemId does not belong to this trip's job and tenant");
    expect(prisma.jobItem.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId }),
      }),
    );
  });

  it("rejects jobItemId for unrelated document types", async () => {
    const { service } = makeContext();

    await expect(
      service.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        TripDocumentType.POD_PHOTO,
        imageFile,
        false,
        undefined,
        jobItemId,
      ),
    ).rejects.toThrow(
      "jobItemId is only allowed for CONTAINER_PHOTO and SEAL_PHOTO",
    );
  });

  it("rejects upload when the driver is not assigned to the specified trip", async () => {
    const { service } = makeContext({ assignedDriverUserId: "driver-2" });

    await expect(
      service.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        TripDocumentType.CONTAINER_PHOTO,
        imageFile,
        false,
        undefined,
        jobItemId,
      ),
    ).rejects.toThrow("You are not assigned to this trip");
  });

  it("rejects container-linked photos for non-container jobs", async () => {
    const { service } = makeContext({ jobType: JobType.LCL });

    await expect(
      service.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        TripDocumentType.CONTAINER_PHOTO,
        imageFile,
        false,
        undefined,
        jobItemId,
      ),
    ).rejects.toThrow(
      "Container photo documentation is only valid for container-style jobs",
    );
  });
});
