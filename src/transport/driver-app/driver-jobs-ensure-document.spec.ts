import {
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import {
  TripDocumentRequirementStage,
  TripDocumentResponsibleUploader,
  TripDocumentType,
  TripStatus,
} from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService.ensureRequiredTripDocumentForDriver", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const driverUserId = "driver-1";

  function makeSvc(opts?: {
    assignedDriverUserId?: string | null;
    jobFound?: boolean;
    tripStatus?: TripStatus;
    requirements?: any[];
    existingDoc?: any | null;
    generateImpl?: (...args: any[]) => Promise<any>;
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
                status: "ONGOING",
                assignedDriverUserId: assigned,
              },
        ),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: tripId,
          tenantId,
          jobId,
          status: opts?.tripStatus ?? TripStatus.ONGOING,
          assignedDriverUserId: assigned,
        }),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue(opts?.existingDoc ?? null),
      },
      tripDocumentRequirement: {
        findMany: jest.fn().mockResolvedValue(
          opts?.requirements ?? [
            {
              id: "req-lorry",
              type: TripDocumentType.LORRY_CHIT,
              label: "Lorry Chit",
              isRequired: true,
              requiresSignature: true,
              minCount: 1,
              sortOrder: 2,
              responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
              requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
            },
          ],
        ),
      },
    };
    const opsJobs = {
      generateTripDeliveryDoDocument:
        opts?.generateImpl ??
        jest.fn().mockResolvedValue({
          id: "doc-new",
          type: TripDocumentType.LORRY_CHIT,
          tripId,
          tenantId,
          isActive: true,
          originalName: "lorry.pdf",
          mimeType: "application/pdf",
          createdAt: new Date(),
        }),
    };
    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      {
        getClient: () => ({
          storage: {
            from: () => ({
              createSignedUrl: jest.fn().mockResolvedValue({
                data: { signedUrl: "https://x" },
              }),
            }),
          },
        }),
      } as any,
      opsJobs as any,
    );
    return { svc, prisma, opsJobs };
  }

  it("generates missing required Lorry Chit for assigned driver", async () => {
    const { svc, opsJobs } = makeSvc();
    const doc = await svc.ensureRequiredTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      "LORRY_CHIT",
    );
    expect(doc.type).toBe(TripDocumentType.LORRY_CHIT);
    expect(opsJobs.generateTripDeliveryDoDocument).toHaveBeenCalledWith(
      tenantId,
      jobId,
      tripId,
      { userId: driverUserId },
      "MANUAL_REGENERATE",
      null,
      TripDocumentType.LORRY_CHIT,
    );
  });

  it("returns existing document without regenerating (idempotent)", async () => {
    const existing = {
      id: "doc-existing",
      type: TripDocumentType.DELIVERY_DO,
      tripId,
      tenantId,
      isActive: true,
      originalName: "do.pdf",
      mimeType: "application/pdf",
      createdAt: new Date(),
    };
    const { svc, opsJobs } = makeSvc({
      requirements: [
        {
          id: "req-do",
          type: TripDocumentType.DELIVERY_DO,
          label: "Delivery DO",
          isRequired: true,
          requiresSignature: true,
          minCount: 1,
          sortOrder: 1,
          responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
          requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
        },
      ],
      existingDoc: existing,
    });
    const doc = await svc.ensureRequiredTripDocumentForDriver(
      tenantId,
      jobId,
      tripId,
      driverUserId,
      "DELIVERY_DO",
    );
    expect(doc.id).toBe("doc-existing");
    expect(opsJobs.generateTripDeliveryDoDocument).not.toHaveBeenCalled();
  });

  it("rejects unassigned / unauthorized driver", async () => {
    const { svc } = makeSvc({ assignedDriverUserId: "other-driver" });
    await expect(
      svc.ensureRequiredTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        "LORRY_CHIT",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects when type is not required on the trip", async () => {
    const { svc } = makeSvc({
      requirements: [
        {
          id: "req-pod",
          type: TripDocumentType.POD_PHOTO,
          label: "POD",
          isRequired: true,
          requiresSignature: false,
          minCount: 1,
          sortOrder: 0,
          responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
          requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
        },
      ],
    });
    await expect(
      svc.ensureRequiredTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        "LORRY_CHIT",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("surfaces generation failures without waiving the requirement", async () => {
    const { svc } = makeSvc({
      generateImpl: jest
        .fn()
        .mockRejectedValue(new BadRequestException("Add at least one item before generating DO")),
    });
    await expect(
      svc.ensureRequiredTripDocumentForDriver(
        tenantId,
        jobId,
        tripId,
        driverUserId,
        "LORRY_CHIT",
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: "TRIP_DOCUMENT_GENERATION_FAILED",
        documentType: TripDocumentType.LORRY_CHIT,
      }),
    });
  });
});
