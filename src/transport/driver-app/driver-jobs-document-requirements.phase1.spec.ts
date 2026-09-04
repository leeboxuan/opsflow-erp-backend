import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import {
  JobStatus,
  JobType,
  TripDocumentRequirementStage,
  TripDocumentResponsibleUploader,
  TripDocumentType,
  TripStatus,
} from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("Phase 1 driver document requirements — gates and permit ACL", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const driverUserId = "driver-1";

  const permitOpsReq = {
    id: "req-permit",
    type: TripDocumentType.PERMIT,
    label: "Permit",
    isRequired: true,
    requiresSignature: false,
    minCount: 1,
    sortOrder: 0,
    responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
    requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
  };

  const beforeStartReq = {
    id: "req-start-doc",
    type: TripDocumentType.OTHER,
    label: "Start checklist",
    isRequired: true,
    requiresSignature: false,
    minCount: 1,
    sortOrder: 0,
    responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
    requirementStage: TripDocumentRequirementStage.BEFORE_START,
  };

  const beforeCompleteReq = {
    id: "req-pod",
    type: TripDocumentType.POD_PHOTO,
    label: "POD",
    isRequired: true,
    requiresSignature: false,
    minCount: 1,
    sortOrder: 0,
    responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
    requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
  };

  function makeUploadSvc(opts?: {
    assignedDriverUserId?: string | null;
    jobFound?: boolean;
    tripFound?: boolean;
    requirements?: any[];
  }) {
    const assigned = opts?.assignedDriverUserId ?? driverUserId;
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.jobFound === false
            ? null
            : {
                id: jobId,
                tenantId,
                status: JobStatus.ONGOING,
                jobType: JobType.LCL,
                assignedDriverUserId: assigned,
              },
        ),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.tripFound === false
            ? null
            : {
                id: tripId,
                tenantId,
                jobId,
                status: TripStatus.PUBLISHED,
                assignedDriverUserId: assigned,
              },
        ),
      },
      tripDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      tripDocumentRequirement: {
        findMany: jest.fn().mockResolvedValue(opts?.requirements ?? [permitOpsReq]),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: driverUserId, name: "D", email: "d@x.com" }),
      },
    };
    const supabase = {
      getClient: () => ({
        storage: {
          from: () => ({
            upload: jest.fn().mockResolvedValue({ error: null }),
            createSignedUrl: jest
              .fn()
              .mockResolvedValue({ data: { signedUrl: "https://x" } }),
          }),
        },
      }),
    };
    return {
      svc: new DriverJobsService(prisma, { log: jest.fn() } as any, supabase as any),
      prisma,
    };
  }

  it("driver cannot upload Operations-only permit", async () => {
    const { svc } = makeUploadSvc();
    await expect(
      svc.uploadTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        TripDocumentType.PERMIT,
        {
          buffer: Buffer.from("x"),
          mimetype: "application/pdf",
          originalname: "permit.pdf",
          size: 1,
        } as Express.Multer.File,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("driver can view Operations-uploaded permit on assigned trip", async () => {
    const permitDoc = {
      id: "doc-permit",
      type: TripDocumentType.PERMIT,
      tripId,
      tenantId,
      isActive: true,
      originalName: "permit.pdf",
      mimeType: "application/pdf",
      createdAt: new Date(),
      uploadedByUserId: "ops-1",
      uploadedBy: { id: "ops-1", name: "Ops", email: "ops@x.com" },
    };
    const { svc, prisma } = makeUploadSvc();
    prisma.tripDocument.findMany.mockResolvedValue([permitDoc]);
    const docs = await svc.listTripDocumentsForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );
    expect(docs.some((d) => d.type === TripDocumentType.PERMIT)).toBe(true);
  });

  it("driver cannot list trip documents for unauthorized/unassigned job", async () => {
    const { svc } = makeUploadSvc({ jobFound: false });
    await expect(
      svc.listTripDocumentsForDriver(tenantId, jobId, tripId, driverUserId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("BEFORE_START missing requirement blocks startTripWithTrailer", async () => {
    const day = new Date("2026-08-14T02:00:00.000Z");
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: jobId,
          status: JobStatus.ONGOING,
          pickupDate: day,
        }),
      },
      trip: {
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: tripId,
            tenantId,
            jobId,
            status: TripStatus.PUBLISHED,
            assignedDriverUserId: driverUserId,
            plannedStartAt: day,
            startedAt: null,
            tripSequence: 1,
            jobSequence: 1,
          })
          .mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
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
      },
      tripDocumentRequirement: {
        findMany: jest.fn().mockResolvedValue([beforeStartReq]),
      },
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: driverUserId, name: "D", email: "d@x.com" }),
      },
      $transaction: jest.fn(),
    };
    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      {
        getClient: () => ({
          storage: { from: () => ({ upload: jest.fn().mockResolvedValue({ error: null }) }) },
        }),
      } as any,
    );
    jest.spyOn(svc as any, "getTenantTimeZone").mockResolvedValue("Asia/Singapore");
    jest.useFakeTimers();
    jest.setSystemTime(day);

    await expect(
      svc.startTripWithTrailer(tenantId, jobId, tripId, driverUserId, {
        chassisId: "chassis-1",
        trailerNumber: "TRL1",
        trailerPhoto: {
          buffer: Buffer.from("x"),
          mimetype: "image/jpeg",
          originalname: "t.jpg",
          size: 1,
        } as Express.Multer.File,
      }),
    ).rejects.toThrow(/cannot be started yet/i);

    jest.useRealTimers();
  });

  it("BEFORE_COMPLETE missing requirement blocks canComplete / complete path gaps", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: jobId,
          tenantId,
          status: JobStatus.ONGOING,
          jobType: JobType.LCL,
          assignedDriverUserId: driverUserId,
        }),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          tenantId,
          jobId,
          status: TripStatus.ONGOING,
          assignedDriverUserId: driverUserId,
          trailerNumber: "TR1",
          trailerLastLocationCode: "YARD",
          plannedStartAt: new Date(),
          createdAt: new Date(),
        }),
      },
      tripDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      tripDocumentRequirement: {
        findMany: jest.fn().mockResolvedValue([beforeCompleteReq]),
      },
      tripJobItem: { findMany: jest.fn().mockResolvedValue([]) },
      masterTrailerLocation: { findMany: jest.fn().mockResolvedValue([]) },
      jobItem: { count: jest.fn().mockResolvedValue(0) },
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }) },
    };
    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc as any, "computeTrailerCheckoutGapsForTrip").mockResolvedValue({
      requiresTrailerCheckout: false,
      missingTrailerCheckoutFields: [],
      resolvedTrailerParkingLocationCode: null,
      hasTrailerEndPhoto: false,
    });
    jest.spyOn(svc as any, "listTrailerParkingLocations").mockResolvedValue([]);

    const readiness = await svc.getTripCompletionRequirements(
      tenantId,
      jobId,
      tripId,
      driverUserId,
    );
    expect(readiness.canComplete).toBe(false);
    expect(readiness.missingDocuments).toContain("POD_PHOTO");
  });
});
