import { TripDocumentType, TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService.deleteTripDocumentForDriver", () => {
  function createServiceWithDoc(doc: any, tripStatus: TripStatus = TripStatus.ONGOING) {
    const prisma: any = {
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job-1" }) },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip-1",
          tenantId: "tenant-1",
          jobId: "job-1",
          status: tripStatus,
          assignedDriverUserId: "driver-1",
        }),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue(doc),
        update: jest.fn().mockResolvedValue({ ...doc, isActive: false }),
        delete: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const svc = new DriverJobsService(prisma, audit, { getClient: jest.fn() } as any);
    return { svc, prisma, audit };
  }

  it("driver can soft delete own POD_PHOTO", async () => {
    const doc = {
      id: "doc-1",
      tenantId: "tenant-1",
      tripId: "trip-1",
      type: TripDocumentType.POD_PHOTO,
      isActive: true,
      uploadedByUserId: "driver-1",
    };
    const { svc, prisma, audit } = createServiceWithDoc(doc);

    await expect(
      svc.deleteTripDocumentForDriver("tenant-1", "job-1", "trip-1", "doc-1", "driver-1"),
    ).resolves.toEqual({ success: true, documentId: "doc-1" });

    expect(prisma.tripDocument.update).toHaveBeenCalledWith({
      where: { id: "doc-1" },
      data: { isActive: false },
    });
    expect(prisma.tripDocument.delete).not.toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      "tenant-1",
      "TRIP_DOC_DELETE",
      "TRIP",
      "trip-1",
      { jobId: "job-1", documentId: "doc-1", type: TripDocumentType.POD_PHOTO },
      "driver-1",
    );
  });

  it("driver can soft delete own OTHER", async () => {
    const doc = {
      id: "doc-2",
      tenantId: "tenant-1",
      tripId: "trip-1",
      type: TripDocumentType.OTHER,
      isActive: true,
      uploadedByUserId: "driver-1",
    };
    const { svc } = createServiceWithDoc(doc);

    await expect(
      svc.deleteTripDocumentForDriver("tenant-1", "job-1", "trip-1", "doc-2", "driver-1"),
    ).resolves.toEqual({ success: true, documentId: "doc-2" });
  });

  it("rejects delete when OTHER is uploaded by admin", async () => {
    const doc = {
      id: "doc-3",
      tenantId: "tenant-1",
      tripId: "trip-1",
      type: TripDocumentType.OTHER,
      isActive: true,
      uploadedByUserId: "admin-1",
    };
    const { svc, prisma } = createServiceWithDoc(doc);

    await expect(
      svc.deleteTripDocumentForDriver("tenant-1", "job-1", "trip-1", "doc-3", "driver-1"),
    ).rejects.toThrow("You can only delete your own trip documents");
    expect(prisma.tripDocument.update).not.toHaveBeenCalled();
  });

  it.each([
    TripDocumentType.DELIVERY_DO,
    TripDocumentType.PICKUP_DO,
    TripDocumentType.POD_SIGNATURE,
    TripDocumentType.TRAILER_START_PHOTO,
    TripDocumentType.TRAILER_END_PHOTO,
    TripDocumentType.TRAILER_PARKING_PHOTO,
  ])("rejects unsupported type %s", async (type) => {
    const doc = {
      id: "doc-4",
      tenantId: "tenant-1",
      tripId: "trip-1",
      type,
      isActive: true,
      uploadedByUserId: "driver-1",
    };
    const { svc, prisma } = createServiceWithDoc(doc);

    await expect(
      svc.deleteTripDocumentForDriver("tenant-1", "job-1", "trip-1", "doc-4", "driver-1"),
    ).rejects.toThrow("Unsupported trip document type for driver delete");
    expect(prisma.tripDocument.update).not.toHaveBeenCalled();
  });

  it("rejects missing/inactive trip document", async () => {
    const { svc, prisma } = createServiceWithDoc(null);

    await expect(
      svc.deleteTripDocumentForDriver("tenant-1", "job-1", "trip-1", "missing-doc", "driver-1"),
    ).rejects.toThrow("Trip document not found");
    expect(prisma.tripDocument.update).not.toHaveBeenCalled();
  });

  it.each([TripStatus.COMPLETED, TripStatus.DONE])(
    "rejects deletion when trip status is %s",
    async (status) => {
      const doc = {
        id: "doc-5",
        tenantId: "tenant-1",
        tripId: "trip-1",
        type: TripDocumentType.POD_PHOTO,
        isActive: true,
        uploadedByUserId: "driver-1",
      };
      const { svc, prisma } = createServiceWithDoc(doc, status);

      await expect(
        svc.deleteTripDocumentForDriver("tenant-1", "job-1", "trip-1", "doc-5", "driver-1"),
      ).rejects.toThrow("Trip documents cannot be deleted after trip completion/cancellation");
      expect(prisma.tripDocument.findFirst).not.toHaveBeenCalled();
      expect(prisma.tripDocument.update).not.toHaveBeenCalled();
    },
  );

  it("deleted photo is hidden from active list and trip detail", async () => {
    const docs = [
      {
        id: "doc-photo",
        tenantId: "tenant-1",
        jobId: "job-1",
        tripId: "trip-1",
        type: TripDocumentType.POD_PHOTO,
        isActive: true,
        storageKey: "tenant/jobs/job-1/trips/trip-1/pod_photo/1.jpg",
        originalName: "photo.jpg",
        mimeType: "image/jpeg",
        sizeBytes: 10,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z"),
        uploadedByUserId: "driver-1",
        uploadedByNameSnapshot: "Driver One",
        generatedBySystem: false,
        generatedSource: null,
        requiresSignature: false,
        isSigned: false,
        signedAt: null,
        signedByUserId: null,
        signedByName: null,
      },
      {
        id: "doc-do",
        tenantId: "tenant-1",
        jobId: "job-1",
        tripId: "trip-1",
        type: TripDocumentType.DELIVERY_DO,
        isActive: true,
        storageKey: "tenant/jobs/job-1/trips/trip-1/delivery_do/1.pdf",
        originalName: "delivery.pdf",
        mimeType: "application/pdf",
        sizeBytes: 20,
        createdAt: new Date("2026-05-01T00:01:00.000Z"),
        updatedAt: new Date("2026-05-01T00:01:00.000Z"),
        uploadedByUserId: "driver-1",
        uploadedByNameSnapshot: "Driver One",
        generatedBySystem: false,
        generatedSource: null,
        requiresSignature: false,
        isSigned: false,
        signedAt: null,
        signedByUserId: null,
        signedByName: null,
      },
    ];

    const prisma: any = {
      job: { findFirst: jest.fn().mockResolvedValue({ id: "job-1" }) },
      trip: {
        findFirst: jest.fn().mockImplementation(async (args: any) => {
          if (args?.include?.job) {
            return {
              id: "trip-1",
              tenantId: "tenant-1",
              jobId: "job-1",
              title: "Trip 1",
              displayTitle: null,
              status: "ONGOING",
              plannedStartAt: null,
              jobSequence: 1,
              tripSequence: 1,
              originLabel: "Origin",
              destinationLabel: "Dest",
              originAddressLine1: null,
              originAddressLine2: null,
              originPostalCode: null,
              originCountry: null,
              originLat: null,
              originLng: null,
              destinationAddressLine1: null,
              destinationAddressLine2: null,
              destinationPostalCode: null,
              destinationCountry: null,
              destinationLat: null,
              destinationLng: null,
              publishedAt: null,
              startedAt: null,
              closedAt: null,
              assignedDriverUserId: "driver-1",
              trailerNumber: null,
              trailerLastLocationCode: null,
              trailerParkedAt: null,
              trailerParkingLat: null,
              trailerParkingLng: null,
              job: {
                id: "job-1",
                internalRef: "JOB-1",
                externalRef: null,
                jobType: "IMPORT",
                status: "ONGOING",
                customerCompany: { name: "Customer A" },
                items: [],
              },
              documents: docs.filter((d) => d.isActive),
            };
          }
          return {
            id: "trip-1",
            tenantId: "tenant-1",
            jobId: "job-1",
            status: "ONGOING",
            assignedDriverUserId: "driver-1",
          };
        }),
      },
      tripDocument: {
        findFirst: jest.fn().mockImplementation(async (args: any) => docs.find((d) =>
          d.id === args.where.id
          && d.tenantId === args.where.tenantId
          && d.tripId === args.where.tripId
          && d.isActive === args.where.isActive
        ) ?? null),
        update: jest.fn().mockImplementation(async (args: any) => {
          const target = docs.find((d) => d.id === args.where.id);
          if (!target) throw new Error("doc not found");
          target.isActive = args.data.isActive;
          return target;
        }),
        findMany: jest.fn().mockImplementation(async (args: any) => docs.filter((d) =>
          d.tenantId === args.where.tenantId
          && d.tripId === args.where.tripId
          && d.isActive === args.where.isActive
          && args.where.type.in.includes(d.type)
        )),
      },
    };
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: "https://signed/url" } }),
          }),
        },
      }),
    };
    const svc = new DriverJobsService(prisma, { log: jest.fn().mockResolvedValue(undefined) } as any, supabaseService);

    await svc.deleteTripDocumentForDriver("tenant-1", "job-1", "trip-1", "doc-photo", "driver-1");

    const listed = await svc.listTripDocumentsForDriver("tenant-1", "job-1", "trip-1", "driver-1");
    expect(listed.some((d) => d.id === "doc-photo")).toBe(false);
    expect(listed.some((d) => d.id === "doc-do")).toBe(true);

    const detail = await svc.getTripDetailForDriver("tenant-1", "trip-1", "driver-1");
    expect(detail.documents.some((d: any) => d.id === "doc-photo")).toBe(false);
    expect(detail.documents.some((d: any) => d.id === "doc-do")).toBe(true);
  });
});
