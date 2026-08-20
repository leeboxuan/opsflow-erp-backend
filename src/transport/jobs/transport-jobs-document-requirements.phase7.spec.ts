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

describe("Phase 7 document requirement editor CRUD", () => {
  const tenantId = "t1";
  const jobId = "job1";
  const tripId = "trip1";
  const opsUser = {
    userId: "ops-1",
    role: Role.TRANSPORT_STAFF,
    roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
  };

  function makeService(opts?: {
    job?: any;
    trip?: any;
    requirement?: any;
    existingDuplicate?: any;
    documentCount?: number;
  }) {
    const requirement =
      opts?.requirement === undefined
        ? {
            id: "req-1",
            tenantId,
            tripId,
            type: TripDocumentType.PERMIT,
            label: "Permit",
            isRequired: true,
            requiresSignature: false,
            minCount: 1,
            sortOrder: 0,
            responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
            requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
          }
        : opts.requirement;
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
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
      tripDocument: {
        count: jest.fn().mockResolvedValue(opts?.documentCount ?? 0),
      },
      tripDocumentRequirement: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(requirement)
          .mockResolvedValue(opts?.existingDuplicate ?? null),
        aggregate: jest.fn().mockResolvedValue({ _max: { sortOrder: 1 } }),
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: "req-new", ...data }),
        ),
        update: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ ...requirement, ...data }),
        ),
        delete: jest.fn().mockResolvedValue(requirement),
      },
    };
    const svc = new TransportJobsService(
      prisma,
      audit as any,
      { getClient: jest.fn() } as any,
    );
    return { svc, prisma, audit, requirement };
  }

  it("rejects create/patch/delete when trip is frozen (non-DRAFT)", async () => {
    for (const status of [TripStatus.PUBLISHED, TripStatus.ONGOING, TripStatus.COMPLETED]) {
      const { svc } = makeService({ trip: { id: tripId, status } });
      await expect(
        svc.createTripDocumentRequirement(
          tenantId,
          jobId,
          tripId,
          { type: TripDocumentType.POD_PHOTO },
          opsUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.patchTripDocumentRequirement(
          tenantId,
          jobId,
          tripId,
          "req-1",
          { label: "X" },
          opsUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        svc.deleteTripDocumentRequirement(
          tenantId,
          jobId,
          tripId,
          "req-1",
          opsUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it("rejects EITHER uploader for editor create/patch", async () => {
    const { svc } = makeService();
    await expect(
      svc.createTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        {
          type: TripDocumentType.POD_PHOTO,
          responsibleUploader: TripDocumentResponsibleUploader.EITHER,
        },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.patchTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        "req-1",
        { responsibleUploader: TripDocumentResponsibleUploader.EITHER },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects unsupported signature types", async () => {
    const { svc } = makeService({
      requirement: {
        id: "req-1",
        tenantId,
        tripId,
        type: TripDocumentType.PERMIT,
        label: "Permit",
        isRequired: true,
        requiresSignature: false,
        minCount: 1,
        sortOrder: 0,
        responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
        requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
      },
    });
    await expect(
      svc.createTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        {
          type: TripDocumentType.PERMIT,
          requiresSignature: true,
        },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.patchTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        "req-1",
        { requiresSignature: true },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("patches sortOrder and stage with uniqueness + audit", async () => {
    const { svc, prisma, audit, requirement } = makeService();
    prisma.tripDocumentRequirement.findFirst
      .mockReset()
      .mockResolvedValueOnce(requirement)
      .mockResolvedValueOnce(null);

    const updated = await svc.patchTripDocumentRequirement(
      tenantId,
      jobId,
      tripId,
      "req-1",
      {
        sortOrder: 4,
        requirementStage: TripDocumentRequirementStage.BEFORE_START,
        label: "Permit gate",
        minCount: 2,
      },
      opsUser,
    );
    expect(updated.sortOrder).toBe(4);
    expect(updated.requirementStage).toBe(
      TripDocumentRequirementStage.BEFORE_START,
    );
    expect(prisma.tripDocumentRequirement.update).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(
      tenantId,
      "TRIP_DOCUMENT_REQUIREMENT_UPDATED",
      "TRIP_DOCUMENT_REQUIREMENT",
      "req-1",
      expect.objectContaining({ tripId, jobId }),
      "ops-1",
    );
  });

  it("allows type change when no active matching documents and rechecks type+stage", async () => {
    const { svc, prisma, requirement } = makeService({ documentCount: 0 });
    prisma.tripDocumentRequirement.findFirst
      .mockReset()
      .mockResolvedValueOnce(requirement)
      .mockResolvedValueOnce(null);

    await svc.patchTripDocumentRequirement(
      tenantId,
      jobId,
      tripId,
      "req-1",
      {
        type: TripDocumentType.POD_PHOTO,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
      opsUser,
    );
    expect(prisma.tripDocument.count).toHaveBeenCalled();
    expect(prisma.tripDocumentRequirement.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: TripDocumentType.POD_PHOTO,
          requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
        }),
      }),
    );
  });

  it("rejects type change with REQUIREMENT_TYPE_HAS_DOCUMENTS when active docs exist", async () => {
    const { svc, prisma, requirement } = makeService({ documentCount: 3 });
    prisma.tripDocumentRequirement.findFirst.mockReset().mockResolvedValue(requirement);

    try {
      await svc.patchTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        "req-1",
        { type: TripDocumentType.POD_PHOTO },
        opsUser,
      );
      throw new Error("expected conflict");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe("REQUIREMENT_TYPE_HAS_DOCUMENTS");
    }
    expect(prisma.tripDocumentRequirement.update).not.toHaveBeenCalled();
  });

  it("rejects patch stage collision with ConflictException", async () => {
    const { svc, prisma, requirement } = makeService({
      existingDuplicate: { id: "req-other" },
    });
    prisma.tripDocumentRequirement.findFirst
      .mockReset()
      .mockResolvedValueOnce(requirement)
      .mockResolvedValueOnce({ id: "req-other" });

    await expect(
      svc.patchTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        "req-1",
        { requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE },
        opsUser,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(prisma.tripDocumentRequirement.update).not.toHaveBeenCalled();
  });

  it("creates with audit and enforces minCount >= 1", async () => {
    const { svc, prisma, audit } = makeService();
    prisma.tripDocumentRequirement.findFirst.mockReset().mockResolvedValue(null);
    const created = await svc.createTripDocumentRequirement(
      tenantId,
      jobId,
      tripId,
      {
        type: TripDocumentType.DELIVERY_DO,
        label: "Delivery DO",
        minCount: 0,
        requiresSignature: true,
        responsibleUploader: TripDocumentResponsibleUploader.DRIVER,
        requirementStage: TripDocumentRequirementStage.BEFORE_COMPLETE,
      },
      opsUser,
    );
    expect(created.minCount).toBe(1);
    expect(audit.log).toHaveBeenCalledWith(
      tenantId,
      "TRIP_DOCUMENT_REQUIREMENT_CREATED",
      "TRIP_DOCUMENT_REQUIREMENT",
      created.id,
      expect.objectContaining({ type: TripDocumentType.DELIVERY_DO }),
      "ops-1",
    );
  });

  it("returns successful create even when post-commit audit fails", async () => {
    const { svc, prisma, audit } = makeService();
    prisma.tripDocumentRequirement.findFirst.mockReset().mockResolvedValue(null);
    audit.log.mockRejectedValue(new Error("audit unavailable"));
    const created = await svc.createTripDocumentRequirement(
      tenantId,
      jobId,
      tripId,
      { type: TripDocumentType.POD_PHOTO },
      opsUser,
    );
    expect(created.id).toBe("req-new");
    expect(prisma.tripDocumentRequirement.create).toHaveBeenCalled();
  });

  it("rejects delete with REQUIREMENT_HAS_DOCUMENTS without acknowledgement", async () => {
    const { svc, prisma } = makeService({ documentCount: 2 });
    prisma.tripDocumentRequirement.findFirst.mockReset().mockResolvedValue({
      id: "req-1",
      tenantId,
      tripId,
      type: TripDocumentType.PERMIT,
      label: "Permit",
      requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
      responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
    });

    try {
      await svc.deleteTripDocumentRequirement(
        tenantId,
        jobId,
        tripId,
        "req-1",
        opsUser,
        false,
      );
      throw new Error("expected conflict");
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse().code).toBe("REQUIREMENT_HAS_DOCUMENTS");
    }
    expect(prisma.tripDocumentRequirement.delete).not.toHaveBeenCalled();
  });

  it("deletes with confirmPreserveDocuments when matching docs exist", async () => {
    const { svc, prisma, audit } = makeService({ documentCount: 2 });
    prisma.tripDocumentRequirement.findFirst.mockReset().mockResolvedValue({
      id: "req-1",
      tenantId,
      tripId,
      type: TripDocumentType.PERMIT,
      label: "Permit",
      requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
      responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
    });
    const result = await svc.deleteTripDocumentRequirement(
      tenantId,
      jobId,
      tripId,
      "req-1",
      opsUser,
      true,
    );
    expect(result).toEqual({
      ok: true,
      id: "req-1",
      matchingDocumentCount: 2,
      documentsPreserved: true,
    });
    expect(prisma.tripDocumentRequirement.delete).toHaveBeenCalledWith({
      where: { id: "req-1" },
    });
    expect(audit.log).toHaveBeenCalledWith(
      tenantId,
      "TRIP_DOCUMENT_REQUIREMENT_REMOVED",
      "TRIP_DOCUMENT_REQUIREMENT",
      "req-1",
      expect.objectContaining({
        matchingDocumentCount: 2,
        documentsPreserved: true,
        confirmPreserveDocuments: true,
      }),
      "ops-1",
    );
  });

  it("deletes without acknowledgement when no matching documents", async () => {
    const { svc, prisma } = makeService({ documentCount: 0 });
    prisma.tripDocumentRequirement.findFirst.mockReset().mockResolvedValue({
      id: "req-1",
      tenantId,
      tripId,
      type: TripDocumentType.PERMIT,
      label: "Permit",
      requirementStage: TripDocumentRequirementStage.BEFORE_DISPATCH,
      responsibleUploader: TripDocumentResponsibleUploader.OPERATIONS,
    });
    const result = await svc.deleteTripDocumentRequirement(
      tenantId,
      jobId,
      tripId,
      "req-1",
      opsUser,
      false,
    );
    expect(result.ok).toBe(true);
    expect(prisma.tripDocumentRequirement.delete).toHaveBeenCalled();
  });

  it("rejects cross-tenant delete with NotFound", async () => {
    const { svc } = makeService({ job: null });
    await expect(
      svc.deleteTripDocumentRequirement(
        "other-tenant",
        jobId,
        tripId,
        "req-1",
        opsUser,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("Phase 7 document requirement Roles authorization", () => {
  const reflector = new Reflector();
  const guard = new RoleGuard(reflector);

  function ctxFor(handler: (...args: any[]) => any, tenant: Record<string, unknown>) {
    return {
      switchToHttp: () => ({ getRequest: () => ({ tenant }) }),
      getHandler: () => handler,
      getClass: () => TransportJobsController,
    } as any;
  }

  it("allows Tenant Admin / Transport Admin on delete", () => {
    expect(
      guard.canActivate(
        ctxFor(TransportJobsController.prototype.deleteTripDocumentRequirement, {
          tenantId: "t1",
          role: Role.TRANSPORT_STAFF,
          roles: [CanonicalTenantRole.TRANSPORT_ADMIN],
        }),
      ),
    ).toBe(true);
  });

  it("rejects Finance-only on delete", () => {
    expect(() =>
      guard.canActivate(
        ctxFor(TransportJobsController.prototype.deleteTripDocumentRequirement, {
          tenantId: "t1",
          role: Role.FINANCE,
          roles: [CanonicalTenantRole.FINANCE_ADMIN],
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("allows Platform Admin with selected tenant on delete", () => {
    expect(
      guard.canActivate(
        ctxFor(TransportJobsController.prototype.deleteTripDocumentRequirement, {
          tenantId: "t1",
          role: Role.ADMIN,
          roles: [CanonicalTenantRole.TENANT_ADMIN],
          isPlatformAdmin: true,
          authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        }),
      ),
    ).toBe(true);
  });

  it("method roles include delete as Tenant Admin / Transport Admin only", () => {
    expect(
      Reflect.getMetadata(
        "roles",
        TransportJobsController.prototype.deleteTripDocumentRequirement,
      ),
    ).toEqual([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.TRANSPORT_ADMIN,
    ]);
  });
});
