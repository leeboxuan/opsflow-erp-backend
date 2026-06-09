import { CollectionType, JobTripTemplate, JobType, Role } from "@prisma/client";
import { tripCreateManyForJob } from "./job-workflow.helpers";
import {
  OpsJobsService,
  parseValidJobItemsFromInput,
  resolveCollectionTypeForJobCreate,
} from "./ops-jobs.service";

describe("job create: EXPORT and COLLECTION", () => {
  function makeExportCreatePrisma() {
    return {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({
            id: "job1",
            tenantId: "t1",
            customerCompanyId: "comp1",
            internalRef: "WFL-2026-05-0001-EXP",
            jobType: JobType.EXPORT,
            vesselName: data.vesselName ?? null,
            vesselEta: data.vesselEta ?? null,
            returningDepotCode: data.returningDepotCode ?? null,
            returnLastDay: data.returnLastDay ?? null,
            exportOriginDepotCode: data.exportOriginDepotCode ?? null,
            exportPortCode: data.exportPortCode ?? null,
            pickupAddress1: data.pickupAddress1,
            deliveryAddress1: data.deliveryAddress1,
            customerCompany: { id: "comp1", name: "ACME" },
            items: [],
          }),
        ),
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WFL-2026-05-0001-EXP",
          jobType: JobType.EXPORT,
          status: "ONGOING",
          customerCompany: { id: "comp1", name: "ACME" },
          assignedDriver: null,
          createdBy: null,
          items: [],
          trips: [],
          charges: [],
          documents: [],
        }),
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ id: "trip1" }]),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockResolvedValue({ code: "DEPOT-A", name: "Depot A" }),
      },
    };
  }

  function makeSvc(prisma: ReturnType<typeof makeExportCreatePrisma>) {
    const svc = new OpsJobsService(
      prisma as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
    jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "syncJobInvoiceReadinessForJob").mockResolvedValue(undefined);
    return svc;
  }

  it("EXPORT create succeeds without returnDepotCode, returnDepotId, returnLastDay", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.EXPORT,
          customerCompanyId: "comp1",
          pickupAddress1: "Pickup Street 1",
          deliveryAddress1: "Stuffing Street 1",
          receiverName: "PIC",
          receiverPhone: "91234567",
          exportDetails: {
            pickupDepotCode: "DEPOT-A",
            stuffingAddress1: "Stuffing Street 1",
          },
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).resolves.toBeTruthy();

    const data = prisma.job.create.mock.calls[0][0].data;
    expect(data.returningDepotCode).toBeNull();
    expect(data.returnLastDay).toBeNull();
    expect(prisma.trip.createMany).toHaveBeenCalled();
    const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
    expect(tripRows).toHaveLength(1);
    expect(tripRows[0].jobTripTemplate).toBe(JobTripTemplate.PICKUP_TO_DELIVERY);
  });

  it("EXPORT payload with legacy pickupDepotId, returnDepotId, exportPortId does not fail", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.masterLogisticsLocation.findFirst = jest
      .fn()
      .mockImplementation(({ where }: any) => {
        if (where.type === "DEPOT" && where.id) {
          return Promise.resolve({ code: "DEPOT-A", name: "Depot A" });
        }
        if (where.type === "PORT" && where.id) {
          return Promise.resolve({ code: "PSA", name: "PSA" });
        }
        if (where.code === "DEPOT-A") {
          return Promise.resolve({ code: "DEPOT-A", name: "Depot A" });
        }
        return Promise.resolve(null);
      });
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.EXPORT,
          customerCompanyId: "comp1",
          pickupAddress1: "Pickup Street 1",
          deliveryAddress1: "Stuffing Street 1",
          receiverName: "PIC",
          receiverPhone: "91234567",
          exportDetails: {
            pickupDepotId: "depot-id-1",
            returnDepotId: "depot-id-ignored",
            exportPortId: "port-id-1",
            stuffingAddress1: "Stuffing Street 1",
          },
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).resolves.toBeTruthy();

    const data = prisma.job.create.mock.calls[0][0].data;
    expect(data.exportOriginDepotCode).toBe("DEPOT-A");
    expect(data.exportPortCode).toBe("PSA");
    expect(data.returningDepotCode).toBeNull();
  });

  it("EXPORT create succeeds with pickup address only (no depot code)", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.EXPORT,
          customerCompanyId: "comp1",
          pickupAddress1: "Pickup Street 1",
          deliveryAddress1: "Stuffing Street 1",
          receiverName: "PIC",
          receiverPhone: "91234567",
          exportDetails: {
            stuffingAddress1: "Stuffing Street 1",
          },
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).resolves.toBeTruthy();

    expect(prisma.masterLogisticsLocation.findFirst).not.toHaveBeenCalled();
  });

  it("COLLECTION create without collectionType fails validation", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.COLLECTION,
          customerCompanyId: "comp1",
          pickupAddress1: "7 Gul Cir",
          deliveryAddress1: "8 Gul Cir",
          receiverName: "Receiver",
          receiverPhone: "91234567",
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow(/collectionType is required/i);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("COLLECTION create with EMPTY succeeds", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.job.create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: "job1",
        jobType: JobType.COLLECTION,
        collectionType: data.collectionType,
        internalRef: "WFL-2026-05-0002-COL",
        customerCompany: { id: "comp1", name: "ACME" },
        items: [],
      }),
    );
    prisma.job.findFirst = jest.fn().mockResolvedValue({
      id: "job1",
      tenantId: "t1",
      jobType: JobType.COLLECTION,
      collectionType: CollectionType.EMPTY,
      status: "ONGOING",
      customerCompany: { id: "comp1", name: "ACME" },
      assignedDriver: null,
      createdBy: null,
      items: [],
      trips: [],
      charges: [],
      documents: [],
    });
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.COLLECTION,
          collectionType: CollectionType.EMPTY,
          customerCompanyId: "comp1",
          pickupAddress1: "7 Gul Cir",
          deliveryAddress1: "8 Gul Cir",
          receiverName: "Receiver",
          receiverPhone: "91234567",
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).resolves.toBeTruthy();

    expect(prisma.job.create.mock.calls[0][0].data.collectionType).toBe(
      CollectionType.EMPTY,
    );
  });

  it("COLLECTION create with LOADED succeeds", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.job.create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: "job1",
        jobType: JobType.COLLECTION,
        collectionType: data.collectionType,
        customerCompany: { id: "comp1", name: "ACME" },
        items: [],
      }),
    );
    prisma.job.findFirst = jest.fn().mockResolvedValue({
      id: "job1",
      tenantId: "t1",
      jobType: JobType.COLLECTION,
      collectionType: CollectionType.LOADED,
      status: "ONGOING",
      customerCompany: { id: "comp1", name: "ACME" },
      assignedDriver: null,
      createdBy: null,
      items: [],
      trips: [],
      charges: [],
      documents: [],
    });
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.COLLECTION,
        collectionType: CollectionType.LOADED,
        customerCompanyId: "comp1",
        pickupAddress1: "7 Gul Cir",
        deliveryAddress1: "8 Gul Cir",
        receiverName: "Receiver",
        receiverPhone: "91234567",
      } as any,
      { userId: "u1", role: Role.OPS },
    );

    expect(prisma.job.create.mock.calls[0][0].data.collectionType).toBe(
      CollectionType.LOADED,
    );
  });

  it("LCL/IMPORT/EXPORT create without collectionType still succeeds", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    for (const jobType of [JobType.LCL, JobType.IMPORT, JobType.EXPORT]) {
      prisma.job.create.mockClear();
      prisma.trip.createMany.mockClear();
      prisma.job.create = jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          id: "job1",
          jobType: data.jobType,
          collectionType: data.collectionType ?? null,
          customerCompany: { id: "comp1", name: "ACME" },
          items: [],
        }),
      );
      prisma.job.findFirst = jest.fn().mockResolvedValue({
        id: "job1",
        tenantId: "t1",
        jobType,
        collectionType: null,
        status: "ONGOING",
        customerCompany: { id: "comp1", name: "ACME" },
        assignedDriver: null,
        createdBy: null,
        items: [],
        trips: [],
        charges: [],
        documents: [],
      });

      const payload: any = {
        jobType,
        customerCompanyId: "comp1",
        pickupAddress1: "Pickup",
        deliveryAddress1: "Delivery",
        receiverName: "Receiver",
        receiverPhone: "91234567",
      };
      if (jobType === JobType.IMPORT) {
        payload.importDetails = { pickupPortCode: "BRANI" };
        prisma.masterLogisticsLocation.findFirst = jest
          .fn()
          .mockResolvedValue({ code: "BRANI", name: "Brani" });
      }

      await expect(
        svc.create("t1", payload, { userId: "u1", role: Role.OPS }),
      ).resolves.toBeTruthy();
      expect(prisma.job.create.mock.calls[0][0].data.collectionType).toBeNull();
    }
  });

  it("COLLECTION create succeeds with no items and one pickup-delivery trip", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.job.create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: "job1",
        jobType: JobType.COLLECTION,
        internalRef: "WFL-2026-05-0002-COL",
        customerCompany: { id: "comp1", name: "ACME" },
        items: [],
      }),
    );
    prisma.job.findFirst = jest.fn().mockResolvedValue({
      id: "job1",
      tenantId: "t1",
      jobType: JobType.COLLECTION,
      collectionType: CollectionType.EMPTY,
      status: "ONGOING",
      customerCompany: { id: "comp1", name: "ACME" },
      assignedDriver: null,
      createdBy: null,
      items: [],
      trips: [],
      charges: [],
      documents: [],
    });
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.COLLECTION,
          collectionType: CollectionType.EMPTY,
          customerCompanyId: "comp1",
          pickupAddress1: "7 Gul Cir",
          deliveryAddress1: "8 Gul Cir",
          receiverName: "Receiver",
          receiverPhone: "91234567",
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).resolves.toBeTruthy();

    const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
    expect(tripRows).toHaveLength(1);
    expect(tripRows[0].jobTripTemplate).toBe(JobTripTemplate.PICKUP_TO_DELIVERY);
    expect(prisma.job.create.mock.calls[0][0].data.internalRef).toMatch(/-COL$/);
  });

  it("COLLECTION create persists optional containerNumber and sealNo", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.job.create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: "job1",
        jobType: JobType.COLLECTION,
        customerCompany: { id: "comp1", name: "ACME" },
        items: data.items?.create ?? [],
      }),
    );
    prisma.job.findFirst = jest.fn().mockResolvedValue({
      id: "job1",
      tenantId: "t1",
      jobType: JobType.COLLECTION,
      collectionType: CollectionType.LOADED,
      status: "ONGOING",
      customerCompany: { id: "comp1", name: "ACME" },
      assignedDriver: null,
      createdBy: null,
      items: [],
      trips: [],
      charges: [],
      documents: [],
    });
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.COLLECTION,
        collectionType: CollectionType.LOADED,
        customerCompanyId: "comp1",
        pickupAddress1: "7 Gul Cir",
        deliveryAddress1: "8 Gul Cir",
        receiverName: "Receiver",
        receiverPhone: "91234567",
        items: [{ containerNumber: "CONT123", sealNo: "SEAL9", pickupReference: "REF-88" }],
      } as any,
      { userId: "u1", role: Role.OPS },
    );

    const itemsCreate = prisma.job.create.mock.calls[0][0].data.items.create;
    expect(itemsCreate).toEqual([
      expect.objectContaining({
        itemCode: "CONT123",
        sealNo: "SEAL9",
        pickupReference: "REF-88",
        qty: null,
      }),
    ]);
  });
});

describe("parseValidJobItemsFromInput container cargo", () => {
  it("IMPORT/EXPORT/COLLECTION do not require qty", () => {
    const rows = parseValidJobItemsFromInput(
      [{ containerNumber: "ABCD1234567", sealNo: "S1", pickupReference: "PU-REF-1" }],
      JobType.IMPORT,
    );
    expect(rows).toEqual([
      {
        itemCode: "ABCD1234567",
        description: null,
        sealNo: "S1",
        pickupReference: "PU-REF-1",
        qty: null,
      },
    ]);
  });

  it("LCL still defaults qty when omitted", () => {
    const rows = parseValidJobItemsFromInput([{ itemCode: "BOX-A" }], JobType.LCL);
    expect(rows[0].qty).toBe(1);
  });

  it("EXPORT trip generation creates exactly one leg", () => {
    const rows = tripCreateManyForJob("t1", "j1", JobType.EXPORT, null, null, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].displayTitle).toBe("Pickup to Export Point");
  });
});

describe("resolveCollectionTypeForJobCreate", () => {
  it("returns null for non-COLLECTION job types", () => {
    expect(resolveCollectionTypeForJobCreate(JobType.LCL, undefined)).toBeNull();
    expect(resolveCollectionTypeForJobCreate(JobType.IMPORT, "LOADED")).toBeNull();
  });

  it("accepts EMPTY and LOADED for COLLECTION", () => {
    expect(resolveCollectionTypeForJobCreate(JobType.COLLECTION, "EMPTY")).toBe(
      CollectionType.EMPTY,
    );
    expect(resolveCollectionTypeForJobCreate(JobType.COLLECTION, CollectionType.LOADED)).toBe(
      CollectionType.LOADED,
    );
  });
});

describe("getTripDetail COLLECTION cargo sealNo", () => {
  it("returns collectionType on job summary", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "PUBLISHED",
          pendingState: "NONE",
          createdAt: new Date(),
          documents: [],
          payoutLines: [],
          documentRequirements: [],
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WFL-2026-05-0003-COL",
            jobType: "COLLECTION",
            collectionType: CollectionType.EMPTY,
            status: "ONGOING",
            receiverName: "R",
            receiverPhone: "1",
            createdAt: new Date(),
            createdBy: null,
            customerCompany: { name: "Customer" },
            items: [],
          },
        }),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const svc = new OpsJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.OPS });
    expect(result.job.collectionType).toBe(CollectionType.EMPTY);
  });

  it("returns sealNo for container mode", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "PUBLISHED",
          pendingState: "NONE",
          createdAt: new Date(),
          documents: [],
          payoutLines: [],
          documentRequirements: [],
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WFL-2026-05-0003-COL",
            jobType: "COLLECTION",
            collectionType: CollectionType.LOADED,
            status: "ONGOING",
            receiverName: "R",
            receiverPhone: "1",
            createdAt: new Date(),
            createdBy: null,
            customerCompany: { name: "Customer" },
            items: [
              {
                id: "it1",
                itemCode: "CONT-777",
                sealNo: "SEAL-42",
                pickupReference: "PU-REF-9",
                description: null,
                qty: null,
              },
            ],
          },
        }),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const svc = new OpsJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.OPS });
    expect(result.cargo.mode).toBe("CONTAINER");
    expect(result.cargo.containers[0]).toMatchObject({
      containerNumber: "CONT-777",
      sealNo: "SEAL-42",
      pickupReference: "PU-REF-9",
    });
  });
});

describe("getTripDetailForDriver pickupReference", () => {
  it("returns collectionType on job summary", async () => {
    const { DriverJobsService } = await import("./driver-jobs.service");
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "PUBLISHED",
          assignedDriverUserId: "driver-1",
          documents: [],
          job: {
            id: "job1",
            internalRef: "WFL-2026-05-0001-COL",
            jobType: "COLLECTION",
            collectionType: CollectionType.LOADED,
            items: [],
          },
        }),
      },
      masterTrailerLocation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getTripDetailForDriver("t1", "trip1", "driver-1");
    expect(result.job.collectionType).toBe(CollectionType.LOADED);
  });

  it("returns pickupReference on container cargo rows", async () => {
    const { DriverJobsService } = await import("./driver-jobs.service");
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "PUBLISHED",
          assignedDriverUserId: "driver-1",
          documents: [],
          job: {
            id: "job1",
            internalRef: "WFL-2026-05-0001-COL",
            jobType: "COLLECTION",
            collectionType: CollectionType.EMPTY,
            items: [
              {
                id: "it1",
                itemCode: "CONT-1",
                sealNo: "S1",
                pickupReference: "REF-DRIVER",
                description: null,
                qty: null,
              },
            ],
          },
        }),
      },
      masterTrailerLocation: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getTripDetailForDriver("t1", "trip1", "driver-1");
    expect(result.cargo.mode).toBe("CONTAINER");
    expect(result.cargo.containers[0].pickupReference).toBe("REF-DRIVER");
  });
});
