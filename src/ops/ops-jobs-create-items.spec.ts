import { BadRequestException } from "@nestjs/common";
import { JobType, Role } from "@prisma/client";
import {
  assertCreateJobItemsRequiredForJobType,
  OpsJobsService,
  readCreateJobItemsInput,
  readUpdateJobItemsInput,
} from "./ops-jobs.service";

describe("create job items (LCL optional)", () => {
  describe("readUpdateJobItemsInput", () => {
    it("returns null when items and cargoItems are omitted", () => {
      expect(readUpdateJobItemsInput({})).toBeNull();
    });

    it("returns [] when items is explicitly empty", () => {
      expect(readUpdateJobItemsInput({ items: [] })).toEqual([]);
    });
  });

  describe("readCreateJobItemsInput", () => {
    it("defaults missing items to []", () => {
      expect(readCreateJobItemsInput({ jobType: JobType.LCL } as any)).toEqual([]);
    });

    it("reads cargoItems alias", () => {
      expect(
        readCreateJobItemsInput({
          cargoItems: [{ itemCode: "A01", qty: 2 }],
        } as any),
      ).toHaveLength(1);
    });
  });

  describe("assertCreateJobItemsRequiredForJobType", () => {
    it("allows empty items for LCL", () => {
      expect(() =>
        assertCreateJobItemsRequiredForJobType(JobType.LCL, [], []),
      ).not.toThrow();
    });

    it("allows empty items for IMPORT", () => {
      expect(() =>
        assertCreateJobItemsRequiredForJobType(JobType.IMPORT, [], []),
      ).not.toThrow();
    });

    it("allows empty items for COLLECTION", () => {
      expect(() =>
        assertCreateJobItemsRequiredForJobType(JobType.COLLECTION, [], []),
      ).not.toThrow();
    });

    it("rejects blank item rows when items array is provided", () => {
      expect(() =>
        assertCreateJobItemsRequiredForJobType(
          JobType.EXPORT,
          [{ itemCode: "  " }],
          [],
        ),
      ).toThrow(
        new BadRequestException(
          "At least one valid item is required when items are provided",
        ),
      );
    });
  });

  describe("OpsJobsService.create", () => {
    const freshJobShape = () => ({
      id: "job1",
      tenantId: "t1",
      customerCompanyId: "comp1",
      internalRef: "WF-2026-05-0001-LCL",
      externalRef: null,
      jobType: JobType.LCL,
      status: "ONGOING",
      notes: null,
      createdByUserId: "u1",
      pickupDate: null,
      pickupAddress1: "7 Gul Cir",
      pickupAddress2: null,
      pickupPostal: null,
      pickupContactName: null,
      pickupContactPhone: null,
      deliveryAddress1: "8 Gul Cir",
      deliveryAddress2: null,
      deliveryPostal: null,
      receiverName: "Derek",
      receiverPhone: "91234565",
      assignedDriverId: null,
      assignedVehicleId: null,
      assignedFleetVehicleId: null,
      assignedVehiclePlateNo: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      deliveredAt: null,
      podRecipientName: null,
      cancelledReason: null,
      cancelledAt: null,
      cancelledByUserId: null,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      pickupPortCode: null,
      returningDepotCode: null,
      exportPortCode: null,
      exportOriginDepotCode: null,
      vesselName: null,
      customerCompany: { id: "comp1", name: "ACME" },
      assignedDriver: null,
      createdBy: { id: "u1", name: "Ops", email: "ops@example.com" },
      items: [],
      trips: [],
      charges: [],
      documents: [],
    });

    function makeCreatePrisma() {
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
              ...freshJobShape(),
              pickupAddress1: data.pickupAddress1,
              deliveryAddress1: data.deliveryAddress1,
            }),
          ),
          findFirst: jest.fn().mockResolvedValue(freshJobShape()),
          update: jest.fn().mockResolvedValue({}),
        },
        trip: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest
            .fn()
            .mockResolvedValueOnce([{ id: "trip1", status: "DRAFT" }])
            .mockResolvedValueOnce([{ id: "trip1" }]),
          update: jest.fn().mockResolvedValue({}),
        },
        masterLogisticsLocation: { findFirst: jest.fn().mockResolvedValue(null) },
      };
    }

    function makeSvc(prisma: ReturnType<typeof makeCreatePrisma>) {
      const svc = new OpsJobsService(
        prisma as any,
        { log: jest.fn().mockResolvedValue(undefined) } as any,
        { getClient: jest.fn() } as any,
      );
      jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});
      jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);
      return svc;
    }

    const baseLclDto = {
      jobType: JobType.LCL,
      customerCompanyId: "comp1",
      pickupAddress1: "7 Gul Cir",
      deliveryAddress1: "8 Gul Cir",
      receiverName: "Derek",
      receiverPhone: "91234565",
    };

    it("creates LCL job without items", async () => {
      const prisma = makeCreatePrisma();
      const svc = makeSvc(prisma);

      await expect(
        svc.create("t1", baseLclDto as any, { userId: "u1", role: Role.OPS }),
      ).resolves.toBeTruthy();

      const createArg = prisma.job.create.mock.calls[0][0];
      expect(createArg.data.items).toBeUndefined();
      expect(createArg.data.internalRef).toMatch(/^WFL-\d{4}-\d{2}-\d{4}-LCL$/);
    });

    it("creates LCL job with empty items array", async () => {
      const prisma = makeCreatePrisma();
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          { ...baseLclDto, items: [] } as any,
          { userId: "u1", role: Role.OPS },
        ),
      ).resolves.toBeTruthy();
    });

    it("creates LCL job with cargoItems alias omitted when items absent", async () => {
      const prisma = makeCreatePrisma();
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          { ...baseLclDto, cargoItems: [] } as any,
          { userId: "u1", role: Role.OPS },
        ),
      ).resolves.toBeTruthy();
    });

    it("creates IMPORT job without return location and generates one port→delivery trip", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockResolvedValue({ code: "JURONG", name: "Jurong Port" }),
      };
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.IMPORT,
            importDetails: {
              pickupPortCode: "JURONG",
            },
          } as any,
          { userId: "u1", role: Role.OPS },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.returningDepotCode).toBeNull();
      const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
      expect(tripRows).toHaveLength(1);
      expect(tripRows[0].jobTripTemplate).toBe("PICKUP_TO_DELIVERY");
    });

    it("creates IMPORT job with returnLastDay only (no return depot) and still generates one trip", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockResolvedValue({ code: "JURONG", name: "Jurong Port" }),
      };
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.IMPORT,
            importDetails: {
              pickupPortCode: "JURONG",
              returnLastDay: "2026-06-30",
            },
          } as any,
          { userId: "u1", role: Role.OPS },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.returningDepotCode).toBeNull();
      expect(jobData.returnLastDay).toEqual(new Date("2026-06-30"));
      expect(prisma.trip.createMany.mock.calls[0][0].data).toHaveLength(1);
    });

    it("creates IMPORT job with return location and generates port→delivery plus delivery→return trips", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterLogisticsLocation = {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ code: "JURONG", name: "Jurong Port" })
          .mockResolvedValueOnce({ code: "GUL", name: "Gul Depot" }),
      };
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.IMPORT,
            importDetails: {
              pickupPortCode: "JURONG",
              returningDepotCode: "GUL",
            },
          } as any,
          { userId: "u1", role: Role.OPS },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.returningDepotCode).toBe("GUL");
      const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
      expect(tripRows).toHaveLength(2);
    });
  });

  describe("OpsJobsService.update", () => {
    const jobRow = {
      id: "job1",
      tenantId: "t1",
      status: "ONGOING",
      jobType: JobType.LCL,
      customerCompanyId: "comp1",
    };

    const freshAfterUpdate = () => ({
      ...jobRow,
      internalRef: "WF-2026-05-0001-LCL",
      externalRef: null,
      notes: null,
      createdByUserId: "u1",
      pickupDate: null,
      pickupAddress1: "A",
      pickupAddress2: null,
      pickupPostal: null,
      pickupContactName: null,
      pickupContactPhone: null,
      deliveryAddress1: "B",
      deliveryAddress2: null,
      deliveryPostal: null,
      receiverName: "R",
      receiverPhone: "1",
      assignedDriverId: null,
      assignedVehicleId: null,
      assignedFleetVehicleId: null,
      assignedVehiclePlateNo: null,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      deliveredAt: null,
      podRecipientName: null,
      cancelledReason: null,
      cancelledAt: null,
      cancelledByUserId: null,
      lastLat: null,
      lastLng: null,
      lastLocationAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      pickupPortCode: null,
      returningDepotCode: null,
      exportPortCode: null,
      exportOriginDepotCode: null,
      vesselName: null,
      customerCompany: { id: "comp1", name: "ACME" },
      assignedDriver: null,
      createdBy: null,
      items: [],
      trips: [],
      charges: [],
      documents: [],
    });

    function makeUpdatePrisma(jobType: JobType = JobType.LCL) {
      const jobItemDeleteMany = jest.fn().mockResolvedValue({ count: 0 });
      const jobItemCreateMany = jest.fn().mockResolvedValue({ count: 0 });
      return {
        job: {
          findFirst: jest
            .fn()
            .mockResolvedValueOnce({ ...jobRow, jobType })
            .mockResolvedValue(freshAfterUpdate()),
          update: jest.fn().mockResolvedValue({ id: "job1" }),
        },
        jobItem: {
          deleteMany: jobItemDeleteMany,
          createMany: jobItemCreateMany,
        },
        $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
          fn({
            job: {
              update: jest.fn().mockResolvedValue({ id: "job1" }),
              findFirst: jest.fn().mockResolvedValue(freshAfterUpdate()),
            },
            jobItem: {
              deleteMany: jobItemDeleteMany,
              createMany: jobItemCreateMany,
            },
          }),
        ),
        jobItemDeleteMany,
        jobItemCreateMany,
      };
    }

    it("allows LCL PATCH with items: [] to clear cargo lines", async () => {
      const prisma = makeUpdatePrisma();
      const svc = new OpsJobsService(
        prisma as any,
        { log: jest.fn() } as any,
        {} as any,
      );
      jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);

      await expect(
        svc.update(
          "t1",
          "job1",
          { receiverName: "Updated", items: [] } as any,
          { userId: "u1", role: Role.OPS },
        ),
      ).resolves.toBeTruthy();

      expect(prisma.jobItemDeleteMany).toHaveBeenCalled();
      expect(prisma.jobItemCreateMany).not.toHaveBeenCalled();
    });

    it("allows IMPORT PATCH with items: [] to clear cargo lines", async () => {
      const prisma = makeUpdatePrisma(JobType.IMPORT);
      const svc = new OpsJobsService(
        prisma as any,
        { log: jest.fn() } as any,
        {} as any,
      );
      jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);

      await expect(
        svc.update("t1", "job1", { items: [] } as any, {
          userId: "u1",
          role: Role.OPS,
        }),
      ).resolves.toBeTruthy();

      expect(prisma.jobItemDeleteMany).toHaveBeenCalled();
    });
  });
});
