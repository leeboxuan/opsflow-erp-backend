import { NotFoundException } from "@nestjs/common";
import { TripDocumentType } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";
import { IDEMPOTENCY_SCOPES } from "../../shared/idempotency/idempotency.util";

describe("DriverJobsService.uploadTripDocumentForDriver operationKey idempotency", () => {
  const tenantId = "tenant-1";
  const jobId = "job-1";
  const tripId = "trip-1";
  const driverUserId = "driver-1";
  const operationKey = "op-doc-upload-aaaaaaaa";
  const imageFile = {
    buffer: Buffer.from([9, 8, 7, 6]),
    mimetype: "image/jpeg",
    originalname: "pod.jpg",
    size: 4,
  } as Express.Multer.File;

  function makeSvc(options?: {
    peekResult?: { outcome: "replayed"; result: Record<string, unknown> } | null;
    executeOutcome?: "created" | "replayed";
  }) {
    const storageUpload = jest.fn().mockResolvedValue({ error: null });
    const storageRemove = jest.fn().mockResolvedValue({ error: null });
    const prisma = {
      job: {
        findFirst: jest.fn().mockResolvedValue({ id: jobId, status: "ONGOING" }),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          jobId,
          status: "ONGOING",
          assignedDriverUserId: driverUserId,
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({
          id: driverUserId,
          name: "Driver",
          email: "d@test.com",
        }),
      },
      tripDocument: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "doc-created",
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            uploadedBy: null,
          }),
        ),
        findFirst: jest.fn().mockResolvedValue({
          id: "doc-created",
          tenantId,
          tripId,
          type: TripDocumentType.POD_PHOTO,
          isActive: true,
          storageKey: "k",
          originalName: "pod.jpg",
          mimeType: "image/jpeg",
          sizeBytes: 4,
          createdAt: new Date(),
          updatedAt: new Date(),
          uploadedBy: null,
        }),
      },
    };

    const peekCompleted = jest.fn().mockResolvedValue(options?.peekResult ?? null);
    const execute = jest.fn().mockImplementation(async (params: {
      execute: (tx: {
        tripDocument: typeof prisma.tripDocument;
      }) => Promise<{
        resourceType: string;
        resourceId: string;
        result: { id: string };
      }>;
      load: (id: string) => Promise<{ id: string }>;
    }) => {
      if (options?.executeOutcome === "replayed") {
        return {
          outcome: "replayed" as const,
          result: await params.load("doc-replayed"),
        };
      }
      const created = await params.execute({
        tripDocument: prisma.tripDocument,
      });
      return { outcome: "created" as const, result: created.result };
    });

    const idempotency = { peekCompleted, execute };
    const service = new DriverJobsService(
      prisma as never,
      { log: jest.fn() } as never,
      {
        getClient: () => ({
          storage: {
            from: () => ({ upload: storageUpload, remove: storageRemove }),
          },
        }),
      } as never,
      undefined,
      undefined,
      undefined,
      idempotency as never,
    );

    return { service, prisma, storageUpload, storageRemove, peekCompleted, execute };
  }

  it("replays completed operationKey without a second storage upload", async () => {
    const replayedDoc = {
      id: "doc-replayed",
      type: TripDocumentType.POD_PHOTO,
      previewUrl: null,
      downloadUrl: null,
    };
    const { service, storageUpload, peekCompleted } = makeSvc({
      peekResult: { outcome: "replayed", result: replayedDoc },
    });

    const result = await service.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      TripDocumentType.POD_PHOTO,
      imageFile,
      false,
      undefined,
      null,
      operationKey,
    );

    expect(result.id).toBe("doc-replayed");
    expect(storageUpload).not.toHaveBeenCalled();
    expect(peekCompleted).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_DOCUMENT_UPLOAD,
        operationKey,
      }),
    );
  });

  it("scopes requestHash with trip/driver and records operationKey on create path", async () => {
    const { service, execute, storageUpload } = makeSvc({ executeOutcome: "created" });

    await service.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      TripDocumentType.POD_PHOTO,
      imageFile,
      false,
      undefined,
      null,
      operationKey,
    );

    expect(storageUpload).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId,
        scope: IDEMPOTENCY_SCOPES.DRIVER_TRIP_DOCUMENT_UPLOAD,
        operationKey,
        requestHash: expect.any(String),
      }),
    );
  });

  it("rejects loading a document from another trip during idempotent replay", async () => {
    const { service, peekCompleted, prisma } = makeSvc();
    peekCompleted.mockImplementation(async (params: {
      load: (id: string) => Promise<unknown>;
    }) => {
      (prisma.tripDocument.findFirst as jest.Mock).mockResolvedValueOnce({
        id: "doc-other-trip",
        tripId: "trip-OTHER",
        tenantId,
        isActive: true,
        type: TripDocumentType.POD_PHOTO,
        storageKey: "k",
        originalName: "x",
        mimeType: "image/jpeg",
        sizeBytes: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        uploadedBy: null,
      });
      await expect(params.load("doc-other-trip")).rejects.toBeInstanceOf(NotFoundException);
      return null;
    });

    await service.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      TripDocumentType.POD_PHOTO,
      imageFile,
      false,
      undefined,
      null,
      operationKey,
    );

    expect(peekCompleted).toHaveBeenCalled();
  });

  it("keeps storage upload outside the idempotent DB execute callback", async () => {
    const { service, execute, storageUpload } = makeSvc({ executeOutcome: "created" });
    let sawStorageDuringExecute = false;
    execute.mockImplementation(async (params: {
      execute: (tx: any) => Promise<{
        resourceType: string;
        resourceId: string;
        result: { id: string };
      }>;
    }) => {
      const uploadsBefore = storageUpload.mock.calls.length;
      expect(uploadsBefore).toBe(1);
      const created = await params.execute({
        tripDocument: {
          updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          create: jest.fn().mockResolvedValue({
            id: "doc-created",
            tenantId,
            tripId,
            type: TripDocumentType.POD_PHOTO,
            isActive: true,
            storageKey: "k",
            originalName: "pod.jpg",
            mimeType: "image/jpeg",
            sizeBytes: 4,
            createdAt: new Date(),
            updatedAt: new Date(),
            uploadedBy: null,
          }),
          count: jest.fn().mockResolvedValue(0),
        },
        $executeRaw: jest.fn().mockResolvedValue(0),
      });
      if (storageUpload.mock.calls.length !== uploadsBefore) {
        sawStorageDuringExecute = true;
      }
      return { outcome: "created" as const, result: created.result };
    });

    await service.uploadTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      TripDocumentType.POD_PHOTO,
      imageFile,
      false,
      undefined,
      null,
      operationKey,
    );

    expect(sawStorageDuringExecute).toBe(false);
    expect(storageUpload).toHaveBeenCalledTimes(1);
  });
});
