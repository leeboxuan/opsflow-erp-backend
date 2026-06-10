import { TripDocumentType, TripStatus } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";
import { DriverJobsService } from "./driver-jobs.service";
import {
  DO_SIGN_REQUIRES_ONGOING_TRIP_MESSAGE,
  pickPreferredSignatureArtifact,
  type SignableDoType,
} from "./do-signature.helpers";

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const tenantId = "tenant-1";
const jobId = "job-1";
const tripId = "trip-1";
const driverUserId = "driver-1";

function makeDoDoc(type: SignableDoType, overrides: Record<string, unknown> = {}) {
  return {
    id: type === TripDocumentType.PICKUP_DO ? "pickup-do-1" : "delivery-do-1",
    tenantId,
    tripId,
    type,
    storageKey: `t1/jobs/j1/trips/t1/${type === TripDocumentType.PICKUP_DO ? "pickup-do" : "delivery-do"}/old.pdf`,
    isSigned: false,
    signedAt: null,
    signedByName: null,
    signedByUserId: null,
    uploadedBy: null,
    ...overrides,
  };
}

function makeService(tripStatus: TripStatus, doc: ReturnType<typeof makeDoDoc>) {
  const tripDocumentUpdate = jest.fn().mockImplementation(({ data }: { data: any }) =>
    Promise.resolve({ ...doc, ...data, uploadedBy: null }),
  );
  const tripDocumentUpdateMany = jest.fn().mockResolvedValue({ count: 0 });
  const signatureDeactivateUpdate = jest.fn().mockResolvedValue({});

  const prisma: any = {
    job: {
      findFirst: jest.fn().mockResolvedValue({
        id: jobId,
        tenantId,
        status: "ONGOING",
      }),
    },
    trip: {
      findFirst: jest.fn().mockResolvedValue({
        id: tripId,
        tenantId,
        jobId,
        status: tripStatus,
        assignedDriverUserId: driverUserId,
      }),
    },
    tripDocument: {
      findFirst: jest
        .fn()
        .mockImplementation(({ where }: { where?: { id?: string } }) => {
          if (where?.id === doc.id) {
            return Promise.resolve({
              ...doc,
              isSigned: true,
              signedByName: doc.signedByName ?? "Shipper Sam",
              signedAt: doc.signedAt ?? new Date("2026-06-10T00:30:00.000Z"),
              storageKey: "refreshed.pdf",
            });
          }
          return Promise.resolve(doc);
        }),
      update: tripDocumentUpdate,
      updateMany: tripDocumentUpdateMany,
    },
  };

  const opsJobs = {
    persistSignedDoSignatureImage: jest.fn().mockResolvedValue({
      id: "sig-new-1",
      storageKey: "t1/signatures/new.png",
    }),
    refreshSignedDoPdf: jest.fn().mockResolvedValue(undefined),
    deactivatePreviousSignedDoSignatureArtifacts: jest
      .fn()
      .mockImplementation(async () => {
        await prisma.tripDocument.updateMany({
          where: {
            type:
              doc.type === TripDocumentType.PICKUP_DO
                ? TripDocumentType.PICKUP_SIGNATURE
                : TripDocumentType.DELIVERY_SIGNATURE,
            isActive: true,
            id: { not: "sig-new-1" },
          },
          data: { isActive: false },
        });
      }),
  } as unknown as OpsJobsService;

  const svc = new DriverJobsService(
    prisma,
    { log: jest.fn() } as any,
    {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            createSignedUrl: jest.fn().mockResolvedValue({
              data: { signedUrl: "https://example.com/doc.pdf" },
              error: null,
            }),
          }),
        },
      }),
    } as any,
    opsJobs,
  );

  jest.spyOn(svc as any, "attachSignedUrl").mockImplementation(async (d: any) => d);

  return {
    svc,
    prisma,
    opsJobs,
    tripDocumentUpdate,
    tripDocumentUpdateMany,
    signatureDeactivateUpdate,
  };
}

describe("DriverJobsService.signTripDocumentForDriver DO signing rules", () => {
  const blockedStatuses = [
    TripStatus.DRAFT,
    TripStatus.PUBLISHED,
    TripStatus.COMPLETED,
    TripStatus.DONE,
    TripStatus.CANCELLED,
  ];

  it.each(blockedStatuses)(
    "blocks initial sign when trip is %s",
    async (status) => {
      const doc = makeDoDoc(TripDocumentType.PICKUP_DO);
      const { svc, opsJobs } = makeService(status, doc);

      await expect(
        svc.signTripDocumentForDriver(
          tenantId,
          jobId,
          tripId,
          doc.id,
          driverUserId,
          {
            signedByName: "Shipper Sam",
            signatureBase64: TINY_PNG_BASE64,
          },
        ),
      ).rejects.toThrow(DO_SIGN_REQUIRES_ONGOING_TRIP_MESSAGE);

      expect(opsJobs.persistSignedDoSignatureImage).not.toHaveBeenCalled();
      expect(opsJobs.refreshSignedDoPdf).not.toHaveBeenCalled();
    },
  );

  it.each(blockedStatuses)(
    "blocks re-sign when trip is %s",
    async (status) => {
      const doc = makeDoDoc(TripDocumentType.DELIVERY_DO, {
        isSigned: true,
        signedAt: new Date("2026-06-10T00:00:00.000Z"),
        signedByName: "Derek",
      });
      const { svc, opsJobs } = makeService(status, doc);

      await expect(
        svc.signTripDocumentForDriver(
          tenantId,
          jobId,
          tripId,
          doc.id,
          driverUserId,
          {
            signedByName: "Derek Updated",
            signatureBase64: TINY_PNG_BASE64,
          },
        ),
      ).rejects.toThrow(DO_SIGN_REQUIRES_ONGOING_TRIP_MESSAGE);

      expect(opsJobs.persistSignedDoSignatureImage).not.toHaveBeenCalled();
      expect(opsJobs.refreshSignedDoPdf).not.toHaveBeenCalled();
    },
  );

  it("allows initial sign when trip is ONGOING", async () => {
    const doc = makeDoDoc(TripDocumentType.PICKUP_DO);
    const { svc, opsJobs, tripDocumentUpdate } = makeService(TripStatus.ONGOING, doc);

    const result = await svc.signTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      doc.id,
      driverUserId,
      {
        signedByName: "Shipper Sam",
        signatureBase64: TINY_PNG_BASE64,
      },
    );

    expect(opsJobs.persistSignedDoSignatureImage).toHaveBeenCalledWith(
      tenantId,
      jobId,
      tripId,
      TripDocumentType.PICKUP_DO,
      expect.objectContaining({
        replaceExisting: false,
        signedByName: "Shipper Sam",
      }),
    );
    expect(opsJobs.refreshSignedDoPdf).toHaveBeenCalled();
    expect(opsJobs.deactivatePreviousSignedDoSignatureArtifacts).toHaveBeenCalledWith(
      tenantId,
      tripId,
      TripDocumentType.PICKUP_DO,
      "sig-new-1",
    );
    expect(tripDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isSigned: true,
          signedByName: "Shipper Sam",
          signedByUserId: driverUserId,
        }),
      }),
    );
    expect(result.signedByName).toBe("Shipper Sam");
  });

  it("allows re-sign when trip is ONGOING", async () => {
    const doc = makeDoDoc(TripDocumentType.DELIVERY_DO, {
      isSigned: true,
      signedAt: new Date("2026-06-10T00:00:00.000Z"),
      signedByName: "Derek",
    });
    const { svc, opsJobs } = makeService(TripStatus.ONGOING, doc);

    await svc.signTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      doc.id,
      driverUserId,
      {
        signedByName: "Derek Updated",
        signatureBase64: TINY_PNG_BASE64,
      },
    );

    expect(opsJobs.persistSignedDoSignatureImage).toHaveBeenCalledWith(
      tenantId,
      jobId,
      tripId,
      TripDocumentType.DELIVERY_DO,
      expect.objectContaining({ replaceExisting: false }),
    );
    expect(opsJobs.refreshSignedDoPdf).toHaveBeenCalledWith(
      tenantId,
      jobId,
      tripId,
      TripDocumentType.DELIVERY_DO,
      expect.objectContaining({ recipientName: "Derek Updated" }),
    );
    expect(opsJobs.deactivatePreviousSignedDoSignatureArtifacts).toHaveBeenCalled();
  });

  it("keeps previous signature active when re-sign PDF refresh fails", async () => {
    const doc = makeDoDoc(TripDocumentType.PICKUP_DO, {
      isSigned: true,
      signedByName: "Shipper Sam",
    });
    const { svc, prisma, opsJobs, tripDocumentUpdate } = makeService(
      TripStatus.ONGOING,
      doc,
    );
    jest
      .spyOn(opsJobs, "refreshSignedDoPdf")
      .mockRejectedValue(new Error("pdf upload failed"));

    await expect(
      svc.signTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        doc.id,
        driverUserId,
        {
          signedByName: "Shipper Sam Retry",
          signatureBase64: TINY_PNG_BASE64,
        },
      ),
    ).rejects.toThrow("pdf upload failed");

    expect(tripDocumentUpdate).toHaveBeenCalledWith({
      where: { id: "sig-new-1" },
      data: { isActive: false },
    });
    expect(opsJobs.deactivatePreviousSignedDoSignatureArtifacts).not.toHaveBeenCalled();
    expect(tripDocumentUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: doc.id },
        data: expect.objectContaining({ isSigned: true }),
      }),
    );
  });

  it("uses latest active signature artifact for admin PDF embed after successful re-sign", () => {
    const artifacts = [
      {
        id: "sig-old",
        type: TripDocumentType.PICKUP_SIGNATURE,
        storageKey: "old.png",
        isActive: false,
        createdAt: new Date("2026-06-10T00:00:00.000Z"),
      },
      {
        id: "sig-new",
        type: TripDocumentType.PICKUP_SIGNATURE,
        storageKey: "new.png",
        isActive: true,
        createdAt: new Date("2026-06-10T01:00:00.000Z"),
      },
    ];

    const picked = pickPreferredSignatureArtifact(
      artifacts.filter((artifact) => artifact.isActive),
      TripDocumentType.PICKUP_DO,
    );

    expect(picked?.id).toBe("sig-new");
    expect(picked?.storageKey).toBe("new.png");
  });
});
