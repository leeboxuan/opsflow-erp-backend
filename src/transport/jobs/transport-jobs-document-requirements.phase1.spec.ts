import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  CanonicalTenantRole,
  JobStatus,
  JobType,
  Role,
  TripDocumentRequirementStage,
  TripDocumentResponsibleUploader,
  TripDocumentType,
  TripStatus,
} from "@prisma/client";
import { AUTH_MODE } from "../../shared/auth/request-context";
import { RoleGuard } from "../../shared/auth/guards/role.guard";
import { TransportJobsController } from "./transport-jobs.controller";
import { TransportJobsService } from "./transport-jobs.service";
import {
  countTripsMissingDocumentRequirementSnapshots,
  tripDocumentRequirementDuplicateKey,
} from "../workflows/trip-document-requirement-evaluation";

describe("Phase 1 document requirements — create/patch/auth/publish", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const opsUser = {
    userId: "ops-1",
    role: Role.TRANSPORT_STAFF,
    roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
  };

  function makeCreateService(opts?: {
    job?: any;
    trip?: any;
    existingRequirement?: any;
  }) {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.job === undefined
            ? {
                id: jobId,
                tenantId,
                jobType: JobType.LCL,
                status: JobStatus.ONGOING,
                customerCompanyId: "cc1",
              }
            : opts.job,
        ),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue(
          opts?.trip === undefined
            ? { id: tripId, status: TripStatus.DRAFT }
            : opts.trip,
        ),
      },
      tripDocumentRequirement: {
        findFirst: jest
          .fn()
          .mockResolvedValue(opts?.existingRequirement ?? null),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 0 } }),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: "req-new", ...data }),
        ),
        update: jest.fn(),
      },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    return { svc, prisma };
  }

  it("rejects cross-tenant create with NotFound", async () => {
    const { svc, prisma } = makeCreateService({ job: null });
    await expect(
      svc.createTripDocumentRequirement(
        "other-tenant",
        jobId,
        tripId,
        {
          type: TripDocumentType.PERMIT,
          responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
          requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
        },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.job.findFirst).toHaveBeenCalledWith({
      where: { id: jobId, tenantId: "other-tenant" },
    });
  });

  it("rejects cross-tenant patch with NotFound", async () => {
    const { svc } = makeCreateService({ job: null });
    await expect(
      svc.patchTripDocumentRequirement(
        "other-tenant",
        jobId,
        tripId,
        "req-1",
        { isRequired: false },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects duplicate create for trip+type+stage with ConflictException", async () => {
    const { svc, prisma } = makeCreateService({
      existingRequirement: { id: "req-existing" },
    });
    await expect(
      svc.createTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        {
          type: TripDocumentType.PERMIT,
          responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
          requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
        },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tripDocumentRequirement.create).not.toHaveBeenCalled();
    expect(
      tripDocumentRequirementDuplicateKey({
        tenantId,
        tripId,
        type: TripDocumentType.PERMIT,
        requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
      }),
    ).toBe(`${tenantId}:${tripId}:PERMIT:BEFORE_DISPATCH`);
  });

  it("maps create-time unique-constraint race to ConflictException", async () => {
    const { svc, prisma } = makeCreateService();
    prisma.tripDocumentRequirement.findFirst.mockResolvedValue(null);
    const raceError: any = new Error("Unique constraint failed");
    raceError.code = "P2002";
    raceError.meta = {
      target: ["tenantId", "tripId", "type", "requirementStage"],
    };
    prisma.tripDocumentRequirement.create.mockRejectedValue(raceError);

    await expect(
      svc.createTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        {
          type: TripDocumentType.PERMIT,
          responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
          requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
        },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects repeated create clicks (second request conflicts)", async () => {
    const { svc, prisma } = makeCreateService();
    prisma.tripDocumentRequirement.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "req-existing" });

    await svc.createTripDocumentRequirement(
      tenantId,
      jobId,
      tripId,
      {
        type: TripDocumentType.PERMIT,
        requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
      },
      opsUser,
    );
    await expect(
      svc.createTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        {
          type: TripDocumentType.PERMIT,
          requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
        },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("BEFORE_DISPATCH missing permit blocks publishTrip", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: tripId,
            status: TripStatus.DRAFT,
            driverEarningCents: 1000,
            assignedDriverUserId: "d1",
            driverId: null,
            vehicleId: "v1",
            fleetVehicleId: null,
            containerNumber: null,
            jobId,
            jobTripTemplate: null,
          })
          .mockResolvedValueOnce({
            status: TripStatus.DRAFT,
            documents: [],
            documentRequirements: [
              {
                id: "req-permit",
                type: TripDocumentType.PERMIT,
                label: "Permit",
                isRequired: true,
                requiresSignature: false,
                minCount: 1,
                sortOrder: 0,
                responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
                requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
              },
            ],
          }),
        update: jest.fn(),
      },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc as any, "getTripPublishState").mockResolvedValue({
      readiness: { canPublish: true, totalPayoutCents: 1000, payoutLineCount: 1 },
      payoutLines: [{ id: "pl1" }],
    });
    jest
      .spyOn(svc as any, "ensureTripJobItemsReadyForPublish")
      .mockResolvedValue({ ok: true });

    await expect(
      svc.publishTrip(tenantId, jobId, tripId, opsUser),
    ).rejects.toThrow(/before dispatch/i);
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("rejects cross-tenant uploadTripDocument with NotFound", async () => {
    const prisma: any = {
      trip: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    await expect(
      svc.uploadTripDocument(
        "other-tenant",
        jobId,
        tripId,
        TripDocumentType.PERMIT,
        {
          buffer: Buffer.from("x"),
          mimetype: "application/pdf",
          originalname: "permit.pdf",
          size: 1,
        } as Express.Multer.File,
        false,
        opsUser,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("exposes read-only preflight for trips missing snapshots", () => {
    const preflight = countTripsMissingDocumentRequirementSnapshots({
      tripIds: ["a", "b", "c"],
      requirementTripIds: ["a"],
    });
    expect(preflight.tripsMissingSnapshots).toBe(2);
    expect(preflight.missingTripIds).toEqual(["b", "c"]);
  });
});

describe("Phase 1 document requirement Roles authorization", () => {
  const reflector = new Reflector();
  const guard = new RoleGuard(reflector);

  function ctxFor(handler: (...args: any[]) => any, tenant: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
      getHandler: () => handler,
      getClass: () => TransportJobsController,
    } as any;
  }

  it("allows Tenant Admin and Transport Admin on create/patch", () => {
    for (const handler of [
      TransportJobsController.prototype.createTripDocumentRequirement,
      TransportJobsController.prototype.patchTripDocumentRequirement,
    ]) {
      expect(
        guard.canActivate(
          ctxFor(handler, {
            tenantId: "t1",
            role: Role.ADMIN,
            roles: [CanonicalTenantRole.TENANT_ADMIN],
          }),
        ),
      ).toBe(true);
      expect(
        guard.canActivate(
          ctxFor(handler, {
            tenantId: "t1",
            role: Role.TRANSPORT_STAFF,
            roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
          }),
        ),
      ).toBe(true);
    }
  });

  it("rejects Finance-only user on create/patch", () => {
    expect(() =>
      guard.canActivate(
        ctxFor(TransportJobsController.prototype.createTripDocumentRequirement, {
          tenantId: "t1",
          role: Role.FINANCE,
          roles: [CanonicalTenantRole.FINANCE_ADMIN],
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("allows Platform Admin with explicit selected tenant", () => {
    expect(
      guard.canActivate(
        ctxFor(TransportJobsController.prototype.createTripDocumentRequirement, {
          tenantId: "t1",
          role: Role.ADMIN,
          roles: [CanonicalTenantRole.TENANT_ADMIN],
          isPlatformAdmin: true,
          authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        }),
      ),
    ).toBe(true);
  });

  it("method roles are Tenant Admin / Transport Admin only", () => {
    expect(
      Reflect.getMetadata(
        "roles",
        TransportJobsController.prototype.createTripDocumentRequirement,
      ),
    ).toEqual([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.TRANSPORT_ADMIN,
    ]);
    expect(
      Reflect.getMetadata(
        "roles",
        TransportJobsController.prototype.patchTripDocumentRequirement,
      ),
    ).toEqual([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.TRANSPORT_ADMIN,
    ]);
  });
});
