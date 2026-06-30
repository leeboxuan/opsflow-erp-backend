import sharp from "sharp";
import { TripDocumentType } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";
import * as signatureImageNormalize from "../transport/documents/signature-image-normalize";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function makeJob() {
  return {
    id: "j1",
    internalRef: "JOB-1",
    externalRef: null,
    pickupDate: new Date("2026-06-10T00:00:00.000Z"),
    pickupAddress1: "Pickup St",
    pickupAddress2: null,
    pickupPostal: "654321",
    pickupContactName: "Shipper Sam",
    pickupContactPhone: "81111111",
    deliveryAddress1: "Delivery St",
    deliveryAddress2: null,
    deliveryPostal: "123456",
    receiverName: "Receiver",
    receiverPhone: "90000000",
    notes: null,
    customerCompany: { name: "ACME" },
    items: [{ itemCode: "ITEM1", description: null, qty: 1 }],
  };
}

function makeRefreshPrisma(doType: TripDocumentType) {
  const tripDocumentUpdate = jest.fn().mockResolvedValue({});
  const folder = doType === TripDocumentType.PICKUP_DO ? "pickup-do" : "delivery-do";
  const doDoc = {
    id: doType === TripDocumentType.PICKUP_DO ? "pickup-do-1" : "do-1",
    type: doType,
    storageKey: `t1/jobs/j1/trips/t1/${folder}/old.pdf`,
    isSigned: false,
    signedAt: null,
    signedByName: null,
  };

  return {
    prisma: {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "t1",
          assignedDriverUserId: "driver-1",
          status: "ONGOING",
        }),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue(makeJob()),
      },
      tripDocument: {
        findFirst: jest
          .fn()
          .mockImplementation(
            ({
              where,
            }: {
              where: {
                type?: TripDocumentType;
                id?: string;
              };
            }) => {
              if (where.id) {
                return Promise.resolve({
                  ...doDoc,
                  signedByName: "Derek",
                  signedAt: new Date("2026-06-10T00:30:00.000Z"),
                  isSigned: true,
                });
              }
              if (where.type === doType) {
                return Promise.resolve(doDoc);
              }
              return Promise.resolve(null);
            },
          ),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(({ data }: { data: any }) =>
          Promise.resolve({
            id: "sig-doc-1",
            ...data,
          }),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: tripDocumentUpdate,
      },
    },
    tripDocumentUpdate,
    doDoc,
    folder,
    storage: {
      upload: jest.fn().mockResolvedValue({ error: null }),
      remove: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest.fn().mockResolvedValue({
        data: { signedUrl: "https://example.com/signed.pdf" },
        error: null,
      }),
      download: jest.fn().mockResolvedValue({
        data: {
          arrayBuffer: async () =>
            TINY_PNG.buffer.slice(
              TINY_PNG.byteOffset,
              TINY_PNG.byteOffset + TINY_PNG.byteLength,
            ),
        },
        error: null,
      }),
    },
  };
}

function makeSvc(prisma: ReturnType<typeof makeRefreshPrisma>["prisma"], storage: any) {
  return new OpsJobsService(
    prisma as any,
    { log: jest.fn() } as any,
    {
      getClient: jest.fn().mockReturnValue({
        storage: { from: jest.fn().mockReturnValue(storage) },
      }),
    } as any,
  );
}

describe("Signed DO PDF rendering", () => {
  it("buildDoPdfBuffer produces a larger pickup PDF when signature image is embedded", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.PICKUP_DO);
    const svc = makeSvc(prisma, storage);
    const signedAt = new Date("2026-06-10T00:30:00.000Z");

    const unsignedPdf = await (svc as any).buildDoPdfBuffer(makeJob(), {
      variant: "pickup",
    });
    const signedPdf = await (svc as any).buildDoPdfBuffer(makeJob(), {
      variant: "pickup",
      signatureImageBytes: TINY_PNG,
      recipientName: "Shipper Sam",
      signedAt,
    });

    expect(signedPdf.length).toBeGreaterThan(unsignedPdf.length);
    expect(signedPdf.subarray(0, 4).toString()).toBe("%PDF");
  });

  it("buildDoPdfBuffer normalizes transparent signature PNG before embed", async () => {
    const transparentSignaturePng = await sharp({
      create: {
        width: 120,
        height: 40,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp({
            create: {
              width: 100,
              height: 3,
              channels: 4,
              background: { r: 0, g: 0, b: 0, alpha: 255 },
            },
          })
            .png()
            .toBuffer(),
          top: 18,
          left: 10,
        },
      ])
      .png()
      .toBuffer();
    const normalizeSpy = jest.spyOn(
      signatureImageNormalize,
      "normalizeSignatureImageForPdf",
    );
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.PICKUP_DO);
    const svc = makeSvc(prisma, storage);
    const signedAt = new Date("2026-06-10T00:30:00.000Z");

    const signedPdf = await (svc as any).buildDoPdfBuffer(makeJob(), {
      variant: "pickup",
      signatureImageBytes: transparentSignaturePng,
      recipientName: "Shipper Sam",
      signedAt,
    });

    expect(normalizeSpy).toHaveBeenCalledWith(transparentSignaturePng);
    expect(signedPdf.subarray(0, 4).toString()).toBe("%PDF");
    normalizeSpy.mockRestore();
  });

  it("refreshSignedDoPdf uploads new PDF and updates PICKUP_DO storage", async () => {
    const { prisma, storage, tripDocumentUpdate, folder } = makeRefreshPrisma(
      TripDocumentType.PICKUP_DO,
    );
    const svc = makeSvc(prisma, storage);

    await svc.refreshSignedDoPdf("t1", "j1", "t1", TripDocumentType.PICKUP_DO, {
      signatureImageBytes: TINY_PNG,
      recipientName: "Shipper Sam",
      signedAt: new Date("2026-06-10T00:30:00.000Z"),
    });

    expect(storage.upload).toHaveBeenCalled();
    expect(tripDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pickup-do-1" },
        data: expect.objectContaining({
          storageKey: expect.stringContaining(`/${folder}/`),
          sizeBytes: expect.any(Number),
          isSigned: true,
          signedByName: "Shipper Sam",
        }),
      }),
    );
  });

  it("refreshSignedDeliveryDoPdf still updates DELIVERY_DO storage", async () => {
    const { prisma, storage, tripDocumentUpdate } = makeRefreshPrisma(
      TripDocumentType.DELIVERY_DO,
    );
    const svc = makeSvc(prisma, storage);

    await svc.refreshSignedDeliveryDoPdf("t1", "j1", "t1", {
      signatureImageBytes: TINY_PNG,
      recipientName: "Derek",
      signedAt: new Date("2026-06-10T00:30:00.000Z"),
    });

    expect(storage.upload).toHaveBeenCalled();
    expect(tripDocumentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "do-1" },
        data: expect.objectContaining({
          storageKey: expect.stringContaining("/delivery-do/"),
        }),
      }),
    );
  });

  it("signTripDocument accepts mobile signatureBase64 and refreshes signed DO PDF", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.DELIVERY_DO);
    prisma.tripDocument.findFirst = jest.fn().mockResolvedValue({
      id: "do-1",
      type: TripDocumentType.DELIVERY_DO,
      storageKey: "t1/jobs/j1/trips/t1/delivery-do/old.pdf",
    });
    prisma.tripDocument.update = jest.fn().mockResolvedValue({
      id: "do-1",
      type: TripDocumentType.DELIVERY_DO,
      storageKey: "t1/jobs/j1/trips/t1/delivery-do/old.pdf",
      isSigned: true,
      signedAt: new Date("2026-06-10T00:30:00.000Z"),
      signedByName: "Derek",
      uploadedBy: null,
    });

    const svc = makeSvc(prisma, storage);
    const refreshSpy = jest.spyOn(svc, "refreshSignedDoPdf").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "attachSignedUrl").mockImplementation((doc: any) => doc);

    await svc.signTripDocument(
      "t1",
      "j1",
      "t1",
      "do-1",
      {
        signedByName: "Derek",
        signedAt: "2026-06-10T00:30:00.000Z",
        signatureBase64: TINY_PNG_BASE64,
        signatureContentType: "image/png",
        documentType: "DELIVERY_DO",
      },
      { userId: "ops-1", role: "OPS" },
    );

    expect(refreshSpy).toHaveBeenCalledWith(
      "t1",
      "j1",
      "t1",
      TripDocumentType.DELIVERY_DO,
      expect.objectContaining({
        recipientName: "Derek",
        signatureImageBytes: expect.any(Buffer),
        signedAt: expect.any(Date),
      }),
    );
  });

  it("signTripDocument triggers signed Pickup DO PDF refresh", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.PICKUP_DO);
    prisma.tripDocument.findFirst = jest.fn().mockResolvedValue({
      id: "pickup-do-1",
      type: TripDocumentType.PICKUP_DO,
      storageKey: "t1/jobs/j1/trips/t1/pickup-do/old.pdf",
    });
    prisma.tripDocument.update = jest.fn().mockResolvedValue({
      id: "pickup-do-1",
      type: TripDocumentType.PICKUP_DO,
      storageKey: "t1/jobs/j1/trips/t1/pickup-do/old.pdf",
      isSigned: true,
      signedAt: new Date("2026-06-10T00:30:00.000Z"),
      signedByName: "Shipper Sam",
      uploadedBy: null,
    });

    const svc = makeSvc(prisma, storage);
    const refreshSpy = jest.spyOn(svc, "refreshSignedDoPdf").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "attachSignedUrl").mockImplementation((doc: any) => doc);

    await svc.signTripDocument(
      "t1",
      "j1",
      "t1",
      "pickup-do-1",
      { signedByName: "Shipper Sam", documentType: "PICKUP_DO" },
      { userId: "ops-1", role: "OPS" },
    );

    expect(refreshSpy).toHaveBeenCalledWith(
      "t1",
      "j1",
      "t1",
      TripDocumentType.PICKUP_DO,
      expect.objectContaining({ recipientName: "Shipper Sam" }),
    );
  });

  it("signTripDocument accepts mobile signatureImage data URL", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.PICKUP_DO);
    prisma.tripDocument.findFirst = jest.fn().mockResolvedValue({
      id: "pickup-do-1",
      type: TripDocumentType.PICKUP_DO,
      storageKey: "t1/jobs/j1/trips/t1/pickup-do/old.pdf",
    });
    prisma.tripDocument.update = jest.fn().mockResolvedValue({
      id: "pickup-do-1",
      type: TripDocumentType.PICKUP_DO,
      storageKey: "t1/jobs/j1/trips/t1/pickup-do/old.pdf",
      isSigned: true,
      signedAt: new Date("2026-06-10T00:30:00.000Z"),
      signedByName: "Shipper Sam",
      uploadedBy: null,
    });

    const svc = makeSvc(prisma, storage);
    const refreshSpy = jest.spyOn(svc, "refreshSignedDoPdf").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "attachSignedUrl").mockImplementation((doc: any) => doc);

    await svc.signTripDocument(
      "t1",
      "j1",
      "t1",
      "pickup-do-1",
      {
        signedByName: "Shipper Sam",
        signatureImage: `data:image/png;base64,${TINY_PNG_BASE64}`,
        documentType: "PICKUP_DO",
      },
      { userId: "ops-1", role: "OPS" },
    );

    expect(refreshSpy).toHaveBeenCalledWith(
      "t1",
      "j1",
      "t1",
      TripDocumentType.PICKUP_DO,
      expect.objectContaining({
        recipientName: "Shipper Sam",
        signatureImageBytes: expect.any(Buffer),
      }),
    );
  });

  it("getTripDocumentSignedUrl lazy-backfills signed Pickup DO PDF", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.PICKUP_DO);
    prisma.job.findFirst = jest.fn().mockResolvedValue({ id: "j1", tenantId: "t1" });
    prisma.trip.findFirst = jest.fn().mockResolvedValue({ id: "t1" });
    prisma.tripDocument.findFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: "pickup-do-1",
        type: TripDocumentType.PICKUP_DO,
        storageKey: "t1/jobs/j1/trips/t1/pickup-do/old.pdf",
        isSigned: true,
        signedAt: new Date("2026-06-10T00:30:00.000Z"),
        signedByName: "Shipper Sam",
      })
      .mockResolvedValueOnce({
        id: "pickup-do-1",
        type: TripDocumentType.PICKUP_DO,
        storageKey: "t1/jobs/j1/trips/t1/pickup-do/refreshed.pdf",
      });

    const svc = makeSvc(prisma, storage);
    const refreshSpy = jest.spyOn(svc, "refreshSignedDoPdf").mockResolvedValue(undefined);

    const result = await svc.getTripDocumentSignedUrl(
      "t1",
      "j1",
      "t1",
      "pickup-do-1",
      { userId: "ops-1", role: "OPS" },
    );

    expect(refreshSpy).toHaveBeenCalledWith(
      "t1",
      "j1",
      "t1",
      TripDocumentType.PICKUP_DO,
    );
    expect(result.previewUrl).toBe("https://example.com/signed.pdf");
  });

  it("persistSignedDoSignatureImage stores PICKUP_SIGNATURE document in Supabase", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.PICKUP_DO);
    const svc = makeSvc(prisma, storage);

    const result = await svc.persistSignedDoSignatureImage(
      "t1",
      "j1",
      "t1",
      TripDocumentType.PICKUP_DO,
      {
        signatureImageBytes: TINY_PNG,
        mimeType: "image/png",
        signedByName: "Shipper Sam",
        signedAt: new Date("2026-06-10T00:30:00.000Z"),
        signedByUserId: "driver-1",
      },
    );

    expect(storage.upload).toHaveBeenCalled();
    expect(prisma.tripDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: TripDocumentType.PICKUP_SIGNATURE,
          storageKey: expect.stringContaining("/signatures/PICKUP_DO/"),
          mimeType: "image/png",
          isSigned: true,
          signedByName: "Shipper Sam",
        }),
      }),
    );
    expect(result.storageKey).toContain("/signatures/PICKUP_DO/");
  });

  it("persistSignedDoSignatureImage with replaceExisting false keeps prior signature active until deactivation", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.PICKUP_DO);
    const svc = makeSvc(prisma, storage);

    await svc.persistSignedDoSignatureImage(
      "t1",
      "j1",
      "t1",
      TripDocumentType.PICKUP_DO,
      {
        signatureImageBytes: TINY_PNG,
        mimeType: "image/png",
        signedByName: "Shipper Sam",
        signedAt: new Date("2026-06-10T00:30:00.000Z"),
        signedByUserId: "driver-1",
        replaceExisting: false,
      },
    );

    expect(prisma.tripDocument.updateMany).not.toHaveBeenCalled();
    expect(prisma.tripDocument.create).toHaveBeenCalled();
  });

  it("persistSignedDoSignatureImage stores DELIVERY_SIGNATURE document in Supabase", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.DELIVERY_DO);
    const svc = makeSvc(prisma, storage);

    await svc.persistSignedDoSignatureImage(
      "t1",
      "j1",
      "t1",
      TripDocumentType.DELIVERY_DO,
      {
        signatureImageBytes: TINY_PNG,
        mimeType: "image/png",
        signedByName: "Derek",
        signedAt: new Date("2026-06-10T00:30:00.000Z"),
        signedByUserId: "driver-1",
      },
    );

    expect(prisma.tripDocument.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: TripDocumentType.DELIVERY_SIGNATURE,
          storageKey: expect.stringContaining("/signatures/DELIVERY_DO/"),
        }),
      }),
    );
  });

  it("signTripDocument persists signature image before refreshing signed DO PDF", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.PICKUP_DO);
    prisma.tripDocument.findFirst = jest.fn().mockResolvedValue({
      id: "pickup-do-1",
      type: TripDocumentType.PICKUP_DO,
      storageKey: "t1/jobs/j1/trips/t1/pickup-do/old.pdf",
    });
    prisma.tripDocument.update = jest.fn().mockResolvedValue({
      id: "pickup-do-1",
      type: TripDocumentType.PICKUP_DO,
      storageKey: "t1/jobs/j1/trips/t1/pickup-do/old.pdf",
      isSigned: true,
      signedAt: new Date("2026-06-10T00:30:00.000Z"),
      signedByName: "Shipper Sam",
      uploadedBy: null,
    });

    const svc = makeSvc(prisma, storage);
    const persistSpy = jest.spyOn(svc, "persistSignedDoSignatureImage").mockResolvedValue({
      id: "sig-doc-1",
      storageKey: "t1/jobs/j1/trips/t1/signatures/PICKUP_DO/1-signature.png",
    });
    const refreshSpy = jest.spyOn(svc, "refreshSignedDoPdf").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "attachSignedUrl").mockImplementation((doc: any) => doc);

    await svc.signTripDocument(
      "t1",
      "j1",
      "t1",
      "pickup-do-1",
      {
        signedByName: "Shipper Sam",
        signatureBase64: TINY_PNG_BASE64,
        signatureContentType: "image/png",
        documentType: "PICKUP_DO",
      },
      { userId: "ops-1", role: "OPS" },
    );

    expect(persistSpy).toHaveBeenCalledWith(
      "t1",
      "j1",
      "t1",
      TripDocumentType.PICKUP_DO,
      expect.objectContaining({
        signatureImageBytes: expect.any(Buffer),
        mimeType: "image/png",
        signedByName: "Shipper Sam",
      }),
    );
    expect(refreshSpy).toHaveBeenCalled();
  });

  it("refreshSignedDoPdf downloads stored DELIVERY_SIGNATURE for PDF embed", async () => {
    const { prisma, storage, tripDocumentUpdate } = makeRefreshPrisma(
      TripDocumentType.DELIVERY_DO,
    );
    prisma.tripDocument.findFirst = jest.fn().mockImplementation(({ where }: any) => {
      if (where.type === TripDocumentType.DELIVERY_DO) {
        return Promise.resolve({
          id: "do-1",
          type: TripDocumentType.DELIVERY_DO,
          storageKey: "t1/jobs/j1/trips/t1/delivery-do/old.pdf",
          isSigned: true,
          signedAt: new Date("2026-06-10T00:30:00.000Z"),
          signedByName: "Derek",
        });
      }
      return Promise.resolve(null);
    });
    prisma.tripDocument.findMany = jest.fn().mockResolvedValue([
      {
        id: "sig-1",
        type: TripDocumentType.DELIVERY_SIGNATURE,
        storageKey: "t1/jobs/j1/trips/t1/signatures/DELIVERY_DO/1-signature.png",
        createdAt: new Date("2026-06-10T00:30:00.000Z"),
      },
    ]);

    const svc = makeSvc(prisma, storage);
    await svc.refreshSignedDoPdf("t1", "j1", "t1", TripDocumentType.DELIVERY_DO);

    expect(storage.download).toHaveBeenCalledWith(
      "t1/jobs/j1/trips/t1/signatures/DELIVERY_DO/1-signature.png",
    );
    expect(tripDocumentUpdate).toHaveBeenCalled();
  });

  it("refreshSignedDoPdf logs warning when signed metadata exists but no signature image", async () => {
    const { prisma, storage } = makeRefreshPrisma(TripDocumentType.PICKUP_DO);
    prisma.tripDocument.findFirst = jest.fn().mockImplementation(({ where }: any) => {
      if (where.type === TripDocumentType.PICKUP_DO) {
        return Promise.resolve({
          id: "pickup-do-1",
          type: TripDocumentType.PICKUP_DO,
          storageKey: "t1/jobs/j1/trips/t1/pickup-do/old.pdf",
          isSigned: true,
          signedAt: new Date("2026-06-10T00:30:00.000Z"),
          signedByName: "Shipper Sam",
        });
      }
      return Promise.resolve(null);
    });
    prisma.tripDocument.findMany = jest.fn().mockResolvedValue([]);

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const svc = makeSvc(prisma, storage);
    await svc.refreshSignedDoPdf("t1", "j1", "t1", TripDocumentType.PICKUP_DO);

    expect(warnSpy).toHaveBeenCalledWith(
      "Signed metadata exists but no signature image found; cannot embed handwritten signature.",
      expect.objectContaining({ doType: TripDocumentType.PICKUP_DO }),
    );
    warnSpy.mockRestore();
  });
});
