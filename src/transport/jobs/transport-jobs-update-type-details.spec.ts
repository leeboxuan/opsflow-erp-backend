import { BadRequestException, NotFoundException } from "@nestjs/common";
import { JobStatus, JobType, Role } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { UpdateJobDto } from "./dto/update-job.dto";
import {
  applyImportDetailsPatch,
  assertTypeSpecificDetailsMatchJobType,
  clearIncompatibleTypeSpecificJobFields,
} from "./job-type-specific-patch";
import { TransportJobsService } from "./transport-jobs.service";

async function validateUpdate(plain: object) {
  const dto = plainToInstance(UpdateJobDto, plain);
  return validate(dto, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe("UpdateJobDto nested type-specific details", () => {
  it("accepts IMPORT importDetails", async () => {
    const errors = await validateUpdate({
      jobType: JobType.IMPORT,
      importDetails: {
        pickupPortCode: "SGSIN",
        portnetReady: false,
        permitReady: true,
      },
    });
    expect(errors).toEqual([]);
  });

  it("rejects unknown nested importDetails properties", async () => {
    const errors = await validateUpdate({
      importDetails: { madeUpField: true },
    });
    expect(JSON.stringify(errors)).toMatch(/madeUpField|should not exist/i);
  });

  it("rejects invalid nested dates", async () => {
    const errors = await validateUpdate({
      importDetails: { vesselEta: "not-a-date" },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("allows explicit null on nullable import fields", async () => {
    const errors = await validateUpdate({
      importDetails: {
        pickupPortCode: null,
        vesselEta: null,
        returningDepotCode: null,
      },
    });
    expect(errors).toEqual([]);
  });
});

describe("type-specific PATCH merge helpers", () => {
  it("merges nested importDetails without replacing omitted keys", () => {
    const data: Record<string, unknown> = {};
    applyImportDetailsPatch(data, { portnetReady: false });
    expect(data).toEqual({ portnetReady: false });
  });

  it("clears nullable fields on explicit null", () => {
    const data: Record<string, unknown> = { pickupPortCode: "SGSIN" };
    applyImportDetailsPatch(data, { pickupPortCode: null });
    expect(data.pickupPortCode).toBeNull();
  });

  it("sets boolean false without treating it as omitted", () => {
    const data: Record<string, unknown> = { portnetReady: true };
    applyImportDetailsPatch(data, { portnetReady: false });
    expect(data.portnetReady).toBe(false);
  });

  it("clears incompatible IMPORT columns when changing to EXPORT", () => {
    const data: Record<string, unknown> = {};
    clearIncompatibleTypeSpecificJobFields(data, JobType.EXPORT);
    expect(data.pickupPortCode).toBeNull();
    expect(data.portnetReady).toBe(false);
    expect(data.exportOriginDepotCode).toBeUndefined();
  });

  it("rejects importDetails on non-IMPORT jobs", () => {
    expect(() =>
      assertTypeSpecificDetailsMatchJobType(JobType.LCL, {
        importDetails: { portnetReady: false },
      }),
    ).toThrow(BadRequestException);
  });
});

describe("TransportJobsService.update type-specific details", () => {
  const existingImport = {
    id: "job1",
    tenantId: "t1",
    customerCompanyId: "comp1",
    jobType: JobType.IMPORT,
    status: JobStatus.ONGOING,
    pickupPortCode: "SGSIN",
    portnetReady: true,
    permitReady: true,
    returningDepotCode: "GUL",
    exportOriginDepotCode: null,
    exportPortCode: null,
  };

  const freshJob = {
    ...existingImport,
    customerCompany: { id: "comp1", name: "ACME" },
    assignedDriver: null,
    createdBy: null,
    items: [
      {
        id: "item-1",
        tenantId: "t1",
        jobId: "job1",
        itemCode: "CMAU9988776",
        sealNo: "SL88903",
        description: null,
        pickupReference: null,
        qty: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
    trips: [],
    charges: [],
    documents: [],
    pickupAddress1: "A",
    deliveryAddress1: "B",
    receiverName: "R",
    receiverPhone: "1",
    internalRef: "WFL-1-IMP",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  function makePrisma(jobRow: any = existingImport) {
    const jobUpdate = jest.fn().mockResolvedValue({ id: "job1" });
    const assignmentJobType = jobRow?.jobType ?? JobType.IMPORT;
    const prisma: any = {
      job: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(jobRow)
          .mockResolvedValue(freshJob),
        update: jobUpdate,
      },
      jobItem: {
        findMany: jest.fn().mockResolvedValue([{ id: "item-1" }]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({}),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      tripJobItem: { findMany: jest.fn().mockResolvedValue([]) },
      jobTypeAssignment: {
        findMany: jest
          .fn()
          .mockResolvedValue(
            jobRow != null && assignmentJobType != null
              ? [{ jobType: assignmentJobType }]
              : [],
          ),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    prisma.jobUpdate = jobUpdate;
    return prisma;
  }

  function makeSvc(prisma: any) {
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc as any, "syncTripRouteSnapshotForJob").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);
    return svc;
  }

  it("PATCHes supported importDetails", async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    await svc.update(
      "t1",
      "job1",
      { importDetails: { vesselName: "ONE HANNOVER" } } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(prisma.jobUpdate.mock.calls[0][0].data).toEqual({
      vesselName: "ONE HANNOVER",
    });
  });

  it("preserves omitted nested import fields on partial PATCH", async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    await svc.update(
      "t1",
      "job1",
      { importDetails: { portnetReady: false } } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    const data = prisma.jobUpdate.mock.calls[0][0].data;
    expect(data.portnetReady).toBe(false);
    expect(data.pickupPortCode).toBeUndefined();
    expect(data.permitReady).toBeUndefined();
  });

  it("clears nullable nested fields on explicit null", async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    await svc.update(
      "t1",
      "job1",
      { importDetails: { pickupPortCode: null } } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(prisma.jobUpdate.mock.calls[0][0].data.pickupPortCode).toBeNull();
  });

  it("sets nested boolean false", async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    await svc.update(
      "t1",
      "job1",
      { importDetails: { permitReady: false } } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(prisma.jobUpdate.mock.calls[0][0].data.permitReady).toBe(false);
  });

  it("keeps tenant isolation on update", async () => {
    const prisma = makePrisma(null);
    const svc = makeSvc(prisma);
    await expect(
      svc.update("t1", "job-other", { notes: "x" } as any, {
        userId: "u1",
        role: Role.TRANSPORT_STAFF,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.jobUpdate).not.toHaveBeenCalled();
  });

  it("updates container items with stable ids", async () => {
    const prisma = makePrisma();
    prisma.jobItem.update = jest.fn().mockResolvedValue({});
    const svc = makeSvc(prisma);
    await svc.update(
      "t1",
      "job1",
      {
        items: [{ id: "item-1", itemCode: "CMAU9988776", sealNo: "SL88903" }],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    expect(prisma.jobItem.update).toHaveBeenCalled();
  });

  it("clears IMPORT-only columns when changing job type to LCL", async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    await svc.update(
      "t1",
      "job1",
      { jobType: JobType.LCL } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );
    const data = prisma.jobUpdate.mock.calls[0][0].data;
    expect(data.jobType).toBe(JobType.LCL);
    expect(data.pickupPortCode).toBeNull();
    expect(data.portnetReady).toBe(false);
    expect(data.permitReady).toBe(false);
    expect(data.returningDepotCode).toBeNull();
  });

  it("rejects importDetails when effective job type is EXPORT", async () => {
    const prisma = makePrisma();
    const svc = makeSvc(prisma);
    await expect(
      svc.update(
        "t1",
        "job1",
        {
          jobType: JobType.EXPORT,
          importDetails: { portnetReady: false },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.jobUpdate).not.toHaveBeenCalled();
  });
});
