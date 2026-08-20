import { CollectionType, JobTripTemplate, JobType, Role } from "@prisma/client";
import { tripCreateManyForJob } from "../workflows/job-workflow.helpers";
import {
  assertExportDestinationFieldsConsistent,
  collectionContainerCountForTripGeneration,
  orderCreatedJobItemIdsBySubmitOrder,
  parseValidJobItemsFromInput,
  resolveCollectionTypeForJobCreate,
  resolveExportDestinationFields,
} from "./create-job-validation.helpers";
import { TransportJobsService } from "./transport-jobs.service";
import { withInteractiveTransaction } from "../test-utils/prisma-interactive-transaction.mock";

describe("job create: EXPORT and COLLECTION", () => {
  function makeExportCreatePrisma() {
    const jobItems: any[] = [];
    const prisma: any = {
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
        findMany: jest.fn().mockResolvedValue([{ id: "trip1", status: "DRAFT" }]),
        update: jest.fn().mockResolvedValue({}),
      },
      jobItem: {
        create: jest.fn().mockImplementation(({ data }) => {
          const item = {
            id: `item_${jobItems.length + 1}`,
            ...data,
          };
          jobItems.push(item);
          return Promise.resolve(item);
        }),
        findMany: jest.fn().mockImplementation(({ where } = {}) =>
          jobItems.filter((item) => {
            if (where?.tenantId && item.tenantId !== where.tenantId) return false;
            if (where?.jobId && item.jobId !== where.jobId) return false;
            if (where?.id?.in && !where.id.in.includes(item.id)) return false;
            return true;
          }),
        ),
      },
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      jobTypeAssignment: {
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ jobType: JobType.EXPORT }]),
      },
      tripDocumentRequirement: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockResolvedValue({ code: "DEPOT-A", name: "Depot A" }),
      },
    };
    return withInteractiveTransaction(prisma);
  }

  function makeSvc(prisma: ReturnType<typeof makeExportCreatePrisma>) {
    const svc = new TransportJobsService(
      prisma as any,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
    jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "syncJobInvoiceReadinessForJob").mockResolvedValue(undefined);
    return svc;
  }

  it("resolveExportDestinationFields prefers stuffing then top-level delivery", () => {
    expect(
      resolveExportDestinationFields({
        deliveryAddress1: "Top Delivery",
        deliveryPostal: "111111",
        stuffingAddress1: "Stuffing Delivery",
        stuffingPostal: "222222",
      }),
    ).toEqual({
      address1: "Stuffing Delivery",
      address2: null,
      postal: "222222",
    });
    expect(
      resolveExportDestinationFields({
        deliveryAddress1: "Top Delivery",
        deliveryPostal: "629356",
      }),
    ).toEqual({
      address1: "Top Delivery",
      address2: null,
      postal: "629356",
    });
  });

  it("assertExportDestinationFieldsConsistent rejects mismatched delivery vs stuffing", () => {
    expect(() =>
      assertExportDestinationFieldsConsistent({
        deliveryAddress1: "20 Gul Way",
        stuffingAddress1: "99 Other St",
      }),
    ).toThrow(/deliveryAddress1 must match/i);
    expect(() =>
      assertExportDestinationFieldsConsistent({
        deliveryAddress1: "20 Gul Way",
        stuffingAddress1: "20 Gul Way",
        deliveryPostal: "629356",
        stuffingPostal: "629356",
      }),
    ).not.toThrow();
  });

  it("EXPORT create with autocomplete pickup address succeeds without depot code", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.EXPORT,
        customerCompanyId: "comp1",
        pickupAddress1: "7 Gul Circle",
        pickupPostal: "629567",
        pickupPlaceId: "ChIJ-export-pickup",
        deliveryAddress1: "20 Gul Way #05-04",
        deliveryPostal: "629356",
        deliveryPlaceId: "ChIJ-export-dest",
        receiverName: "PIC",
        receiverPhone: "91234567",
        exportDetails: { exportPortAddress1: "Pasir Panjang Terminal" },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(prisma.masterLogisticsLocation.findFirst).not.toHaveBeenCalled();
    const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
    expect(tripRows).toHaveLength(1);
    expect(tripRows.map((r: any) => r.jobTripTemplate)).toEqual([
      JobTripTemplate.DELIVERY_TO_PORT,
    ]);
    expect(tripRows.map((r: any) => r.tripSequence)).toEqual([1]);
    expect(tripRows[0].originAddressLine1).toBe("20 Gul Way #05-04");
    expect(tripRows[0].originPlaceId).toBe("ChIJ-export-dest");
    expect(tripRows[0].destinationAddressLine1).toBe("Pasir Panjang Terminal");
  });

  it("EXPORT create without empty depot still succeeds when customer and port are set", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.EXPORT,
          customerCompanyId: "comp1",
          pickupAddress1: "  ",
          deliveryAddress1: "20 Gul Way",
          receiverName: "PIC",
          receiverPhone: "91234567",
          exportDetails: { exportPortAddress1: "Pasir Panjang Terminal" },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).resolves.toBeTruthy();
    expect(prisma.trip.createMany.mock.calls[0][0].data).toHaveLength(1);
  });

  it("EXPORT create without customer fails", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.EXPORT,
          customerCompanyId: "comp1",
          pickupAddress1: "7 Gul Circle",
          deliveryAddress1: "  ",
          receiverName: "PIC",
          receiverPhone: "91234567",
          exportDetails: { exportPortAddress1: "Pasir Panjang Terminal" },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(/Customer \/ stuffing location is required/i);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("EXPORT create seeds trip origin from top-level deliveryAddress1 and deliveryPostal", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.EXPORT,
        customerCompanyId: "comp1",
        pickupAddress1: "7 Gul Circle",
        deliveryAddress1: "20 Gul Way #05-04",
        deliveryPostal: "629356",
        deliveryPlaceId: "ChIJ-export-dest",
        receiverName: "PIC",
        receiverPhone: "91234567",
        exportDetails: { exportPortAddress1: "Pasir Panjang Terminal" },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
    expect(tripRows).toHaveLength(1);
    expect(tripRows[0].jobTripTemplate).toBe(JobTripTemplate.DELIVERY_TO_PORT);
    expect(tripRows[0].originAddressLine1).toBe("20 Gul Way #05-04");
    expect(tripRows[0].originPostalCode).toBe("629356");
    expect(tripRows[0].originPlaceId).toBe("ChIJ-export-dest");
    expect(tripRows[0].destinationAddressLine1).toBe("Pasir Panjang Terminal");
  });

  it("EXPORT create seeds trip destination from exportDetails.stuffing fields", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.EXPORT,
        customerCompanyId: "comp1",
        pickupAddress1: "7 Gul Circle",
        deliveryAddress1: "20 Gul Way #05-04",
        deliveryPostal: "629356",
        receiverName: "PIC",
        receiverPhone: "91234567",
        exportDetails: {
          pickupDepotCode: "DEPOT-A",
          stuffingAddress1: "20 Gul Way #05-04",
          stuffingPostal: "629356",
          exportPortAddress1: "Pasir Panjang Terminal",
        },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
    expect(tripRows).toHaveLength(1);
    expect(tripRows[0].originAddressLine1).toBe("20 Gul Way #05-04");
    expect(tripRows[0].originPostalCode).toBe("629356");
    expect(tripRows[0].destinationAddressLine1).toBe("Pasir Panjang Terminal");
  });

  it("EXPORT create fails when top-level delivery and stuffing destination disagree", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.EXPORT,
          customerCompanyId: "comp1",
          pickupAddress1: "7 Gul Circle",
          deliveryAddress1: "20 Gul Way",
          receiverName: "PIC",
          receiverPhone: "91234567",
          exportDetails: {
            pickupDepotCode: "DEPOT-A",
            stuffingAddress1: "99 Other Street",
          },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(/deliveryAddress1 must match/i);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

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
            exportPortAddress1: "Pasir Panjang Terminal",
          },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).resolves.toBeTruthy();

    const data = prisma.job.create.mock.calls[0][0].data;
    expect(data.returningDepotCode).toBeNull();
    expect(data.returnLastDay).toBeNull();
    expect(prisma.trip.createMany).toHaveBeenCalled();
    const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
    expect(tripRows).toHaveLength(1);
    expect(tripRows[0].jobTripTemplate).toBe(JobTripTemplate.DELIVERY_TO_PORT);
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
            exportPortAddress1: "Pasir Panjang Terminal",
          },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
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
          exportDetails: { exportPortAddress1: "Pasir Panjang Terminal" },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).resolves.toBeTruthy();

    expect(prisma.trip.createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(prisma.masterLogisticsLocation.findFirst).not.toHaveBeenCalled();
  });

  it("create persists empty receiver contact when omitted", async () => {
    const prisma = makeExportCreatePrisma();
    const svc = makeSvc(prisma);

    await svc.create(
      "t1",
      {
        jobType: JobType.EXPORT,
        customerCompanyId: "comp1",
        pickupAddress1: "7 Gul Circle",
        deliveryAddress1: "20 Gul Way",
        exportDetails: { exportPortAddress1: "Pasir Panjang Terminal" },
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    expect(prisma.job.create.mock.calls[0][0].data.receiverName).toBe("");
    expect(prisma.job.create.mock.calls[0][0].data.receiverPhone).toBe("");
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
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).rejects.toThrow(/collectionType is required/i);
    expect(prisma.job.create).not.toHaveBeenCalled();
  });

  it("COLLECTION create with EMPTY succeeds", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.job.create.mockImplementation(({ data }) =>
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
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).resolves.toBeTruthy();

    expect(prisma.job.create.mock.calls[0][0].data.collectionType).toBe(
      CollectionType.EMPTY,
    );
  });

  it("COLLECTION create with LOADED succeeds", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.job.create.mockImplementation(({ data }) =>
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
      { userId: "u1", role: Role.TRANSPORT_STAFF },
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
      prisma.job.create.mockImplementation(({ data }) =>
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
        payload.importDetails = {
          pickupPortCode: "BRANI",
          returningDepotAddress1: "Tuas Depot",
        };
        prisma.masterLogisticsLocation.findFirst = jest
          .fn()
          .mockResolvedValue({ code: "BRANI", name: "Brani" });
      }
      if (jobType === JobType.EXPORT) {
        payload.exportDetails = { exportPortAddress1: "Pasir Panjang Terminal" };
      }

      await expect(
        svc.create("t1", payload, { userId: "u1", role: Role.TRANSPORT_STAFF }),
      ).resolves.toBeTruthy();
      expect(prisma.job.create.mock.calls[0][0].data.collectionType).toBeNull();
    }
  });

  it("COLLECTION create succeeds with no items and one pickup-delivery trip", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.job.create.mockImplementation(({ data }) =>
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
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      ),
    ).resolves.toBeTruthy();

    const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
    expect(tripRows).toHaveLength(1);
    expect(tripRows[0].jobTripTemplate).toBe(JobTripTemplate.PICKUP_TO_DELIVERY);
    expect(prisma.job.create.mock.calls[0][0].data.internalRef).toMatch(/-COL$/);
  });

  it("COLLECTION create persists optional containerNumber and sealNo", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.job.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "job1",
        jobType: JobType.COLLECTION,
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
        items: [{ containerNumber: "CONT123", sealNo: "SEAL9", pickupReference: "REF-88" }],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    const itemsCreate = prisma.jobItem.create.mock.calls.map((call) => call[0].data);
    expect(itemsCreate).toEqual([
      expect.objectContaining({
        itemCode: "CONT123",
        sealNo: "SEAL9",
        pickupReference: null,
        description: null,
        qty: null,
      }),
    ]);
  });

  it("COLLECTION create persists job-level pickupReference and description", async () => {
    const prisma = makeExportCreatePrisma();
    prisma.job.create.mockImplementation(({ data }) =>
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
      pickupReference: "REF-88",
      description: "Job desc",
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
        pickupReference: "REF-88",
        description: "Job desc",
        carrierName: "Maersk",
        voyage: "V1",
        shipper: "Ship Co",
        vesselName: "Vessel A",
        items: [{ containerNumber: "CONT123", sealNo: "SEAL9" }],
      } as any,
      { userId: "u1", role: Role.TRANSPORT_STAFF },
    );

    const createData = prisma.job.create.mock.calls[0][0].data;
    expect(createData.pickupReference).toBe("REF-88");
    expect(createData.description).toBe("Job desc");
    expect(createData.carrierName).toBe("Maersk");
    expect(createData.voyage).toBe("V1");
    expect(createData.shipper).toBe("Ship Co");
    expect(createData.vesselName).toBe("Vessel A");
  });
});

describe("parseValidJobItemsFromInput container cargo", () => {
  it("IMPORT/EXPORT/COLLECTION do not require qty and ignore item pickupReference/description", () => {
    const rows = parseValidJobItemsFromInput(
      [{
        containerNumber: "ABCD1234567",
        sealNo: "S1",
        pickupReference: "PU-REF-1",
        description: "should-ignore",
      }],
      JobType.IMPORT,
    );
    expect(rows).toEqual([
      {
        itemCode: "ABCD1234567",
        description: null,
        sealNo: "S1",
        pickupReference: null,
        qty: null,
      },
    ]);
  });

  it("LCL still defaults qty when omitted", () => {
    const rows = parseValidJobItemsFromInput([{ itemCode: "BOX-A" }], JobType.LCL);
    expect(rows[0].qty).toBe(1);
  });

  it("EXPORT trip generation creates exactly one Customer→Port leg", () => {
    const rows = tripCreateManyForJob("t1", "j1", JobType.EXPORT, null, null, null);
    expect(rows).toHaveLength(1);
    expect(rows.map((r) => r.displayTitle)).toEqual(["Customer to Port"]);
  });

  it("COLLECTION container count uses only parsed container cargo rows", () => {
    const valid = parseValidJobItemsFromInput(
      [
        { containerNumber: "AAAU1" },
        { containerNumber: "" },
        { containerNumber: "ZZZU2" },
      ],
      JobType.COLLECTION,
    );
    expect(valid.map((row) => row.itemCode)).toEqual(["AAAU1", "ZZZU2"]);
    expect(collectionContainerCountForTripGeneration(JobType.COLLECTION, valid)).toBe(2);
    expect(collectionContainerCountForTripGeneration(JobType.LCL, valid)).toBeUndefined();
  });

  it("orderCreatedJobItemIdsBySubmitOrder matches duplicate identities by submit order", () => {
    const submitted = parseValidJobItemsFromInput(
      [
        { containerNumber: "DUP", sealNo: "S1" },
        { containerNumber: "DUP", sealNo: "S1" },
        { containerNumber: "UNIQUE", sealNo: "S2" },
      ],
      JobType.COLLECTION,
    );
    const tiedCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const created = [
      { id: "id-first", itemCode: "DUP", sealNo: "S1", createdAt: tiedCreatedAt },
      { id: "id-second", itemCode: "DUP", sealNo: "S1", createdAt: tiedCreatedAt },
      { id: "id-unique", itemCode: "UNIQUE", sealNo: "S2", createdAt: tiedCreatedAt },
    ];
    expect(orderCreatedJobItemIdsBySubmitOrder(submitted, created)).toEqual([
      "id-first",
      "id-second",
      "id-unique",
    ]);
  });

  it("orderCreatedJobItemIdsBySubmitOrder preserves submitted order regardless of createdAt ties", () => {
    const submitted = parseValidJobItemsFromInput(
      [
        { containerNumber: "ZZZU1000001", sealNo: "S1" },
        { containerNumber: "AAAU2000002", sealNo: "S2" },
        { containerNumber: "MMMU3000003", sealNo: "S3" },
        { containerNumber: "BBBU4000004", sealNo: "S4" },
      ],
      JobType.COLLECTION,
    );
    const tiedCreatedAt = new Date("2026-01-01T00:00:00.000Z");
    const created = [
      { id: "id-b", itemCode: "BBBU4000004", sealNo: "S4", createdAt: tiedCreatedAt },
      { id: "id-a", itemCode: "AAAU2000002", sealNo: "S2", createdAt: tiedCreatedAt },
      { id: "id-m", itemCode: "MMMU3000003", sealNo: "S3", createdAt: tiedCreatedAt },
      { id: "id-z", itemCode: "ZZZU1000001", sealNo: "S1", createdAt: tiedCreatedAt },
    ];
    expect(orderCreatedJobItemIdsBySubmitOrder(submitted, created)).toEqual([
      "id-z",
      "id-a",
      "id-m",
      "id-b",
    ]);
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
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.TRANSPORT_STAFF });
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
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "tji1",
            jobItemId: "it1",
            containerNumberSnapshot: "CONT-777",
            jobItem: {
              id: "it1",
              itemCode: "CONT-777",
              sealNo: "SEAL-42",
              pickupReference: "PU-REF-9",
              description: null,
              qty: null,
            },
          },
        ]),
      },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.TRANSPORT_STAFF });
    expect(result.cargo.mode).toBe("CONTAINER");
    expect(result.cargo.containers[0]).toMatchObject({
      containerNumber: "CONT-777",
      sealNo: "SEAL-42",
      sealNumber: "SEAL-42",
      pickupReference: null,
    });
    expect(result.job.pickupReference).toBe("PU-REF-9");
  });
});

describe("getTripDetailForDriver pickupReference", () => {
  it("returns collectionType on job summary", async () => {
    const { DriverJobsService } = await import("../driver-app/driver-jobs.service");
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

  it("returns job-level pickupReference with legacy item fallback (not duplicated on rows)", async () => {
    const { DriverJobsService } = await import("../driver-app/driver-jobs.service");
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
            pickupReference: null,
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
      tripJobItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "tji1",
            jobItemId: "it1",
            containerNumberSnapshot: "CONT-1",
            jobItem: {
              id: "it1",
              itemCode: "CONT-1",
              sealNo: "S1",
              pickupReference: "REF-DRIVER",
              description: null,
              qty: null,
            },
          },
        ]),
      },
    };
    const svc = new DriverJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getTripDetailForDriver("t1", "trip1", "driver-1");
    expect(result.cargo.mode).toBe("CONTAINER");
    expect(result.job.pickupReference).toBe("REF-DRIVER");
    expect(result.cargo.containers[0].pickupReference).toBeNull();
  });
});
