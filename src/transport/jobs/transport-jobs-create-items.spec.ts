import { BadRequestException } from "@nestjs/common";
import { JobType, Role } from "@prisma/client";
import {
  assertCreateJobItemsRequiredForJobType,
  assertImportPickupSourceForCreate,
  assertPickupLocationForCreate,
  hasAutocompleteLocation,
  importPickupOriginUsesAddressFields,
  readCreateJobItemsInput,
  readUpdateJobItemsInput,
} from "./create-job-validation.helpers";
import { TransportJobsService } from "./transport-jobs.service";
import { withInteractiveTransaction } from "../test-utils/prisma-interactive-transaction.mock";

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

  describe("autocomplete pickup validation", () => {
    it("hasAutocompleteLocation accepts address1 or placeId", () => {
      expect(hasAutocompleteLocation({ address1: "7 Gul Circle" })).toBe(true);
      expect(hasAutocompleteLocation({ placeId: "ChIJxyz" })).toBe(true);
      expect(hasAutocompleteLocation({})).toBe(false);
    });

    it("assertImportPickupSourceForCreate accepts port, address, or placeId", () => {
      expect(() =>
        assertImportPickupSourceForCreate({ pickupPortCode: "JURONG" }),
      ).not.toThrow();
      expect(() =>
        assertImportPickupSourceForCreate({ pickupAddress1: "7 Gul Circle" }),
      ).not.toThrow();
      expect(() =>
        assertImportPickupSourceForCreate({ pickupPlaceId: "ChIJ-import" }),
      ).not.toThrow();
      expect(() => assertImportPickupSourceForCreate({})).toThrow(
        /Import port \/ terminal is required/i,
      );
    });

    it("importPickupOriginUsesAddressFields prefers address over port metadata", () => {
      expect(
        importPickupOriginUsesAddressFields({
          pickupAddress1: "1 Harbour Drive",
        }),
      ).toBe(true);
      expect(importPickupOriginUsesAddressFields({ pickupPostal: "117352" })).toBe(
        true,
      );
      expect(importPickupOriginUsesAddressFields({})).toBe(false);
    });

    it("assertPickupLocationForCreate treats EXPORT empty depot as optional", () => {
      expect(() =>
        assertPickupLocationForCreate({
          jobType: JobType.EXPORT,
          pickupAddress1: "7 Gul Circle",
        }),
      ).not.toThrow();
      expect(() =>
        assertPickupLocationForCreate({
          jobType: JobType.EXPORT,
          pickupPlaceId: "ChIJ-export",
        }),
      ).not.toThrow();
      expect(() =>
        assertPickupLocationForCreate({ jobType: JobType.EXPORT }),
      ).not.toThrow();
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

  describe("TransportJobsService.create", () => {
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
          findMany: jest.fn().mockResolvedValue([{ id: "trip1", status: "DRAFT" }]),
          update: jest.fn().mockResolvedValue({}),
        },
        jobItem: {
          create: jest.fn().mockResolvedValue({ id: "item1" }),
          findMany: jest.fn().mockResolvedValue([]),
        },
        tripJobItem: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        jobTypeAssignment: {
          createMany: jest.fn().mockResolvedValue({ count: 1 }),
          findMany: jest.fn().mockResolvedValue([{ jobType: JobType.LCL }]),
        },
        tripDocumentRequirement: {
          findMany: jest.fn().mockResolvedValue([]),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        masterLogisticsLocation: { findFirst: jest.fn().mockResolvedValue(null) },
        masterSingaporeDepot: { findUnique: jest.fn().mockResolvedValue(null) },
      };
      return withInteractiveTransaction(prisma);
    }

    function makeSvc(prisma: ReturnType<typeof makeCreatePrisma>) {
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
        svc.create("t1", baseLclDto as any, { userId: "u1", role: Role.TRANSPORT_STAFF }),
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
          { userId: "u1", role: Role.TRANSPORT_STAFF },
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
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();
    });

    it("IMPORT with pickupAddress + pickupPortCode uses pickupAddress for trip origin", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockResolvedValue({
          id: "port1",
          code: "JURONG",
          name: "Jurong Port",
          type: "PORT",
        }),
      };
      const svc = makeSvc(prisma);

      await svc.create(
        "t1",
        {
          ...baseLclDto,
          jobType: JobType.IMPORT,
          pickupAddress1: "1 Harbour Drive",
          pickupPostal: "117352",
          importDetails: {
            pickupPortCode: "JURONG",
            returningDepotAddress1: "Tuas Depot",
          },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      );

      expect(prisma.job.create.mock.calls[0][0].data.pickupPortCode).toBe("JURONG");
      const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
      expect(tripRows[0].originAddressLine1).toBe("1 Harbour Drive");
      expect(tripRows[0].originPostalCode).toBe("117352");
      expect(tripRows[0].originLabel).not.toMatch(/JURONG/);
    });

    it("IMPORT with pickupPortCode only uses port master for trip origin", async () => {
      const prisma = makeCreatePrisma();
      prisma.job.findFirst = jest.fn().mockImplementation(async () => ({
        ...freshJobShape(),
        jobType: JobType.IMPORT,
        pickupAddress1: "",
        pickupPortCode: "JURONG",
        trips: [{ id: "trip1", jobTripTemplate: "PICKUP_TO_DELIVERY" }],
      }));
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockResolvedValue({
          id: "port1",
          code: "JURONG",
          name: "Jurong Port",
          type: "PORT",
        }),
      };
      const svc = makeSvc(prisma);

      await svc.create(
        "t1",
        {
          ...baseLclDto,
          jobType: JobType.IMPORT,
          pickupAddress1: "",
          pickupAddress2: null,
          pickupPostal: null,
          importDetails: {
            pickupPortCode: "JURONG",
            returningDepotAddress1: "Tuas Depot",
          },
        } as any,
        { userId: "u1", role: Role.TRANSPORT_STAFF },
      );

      expect(prisma.trip.createMany.mock.calls[0][0].data[0].originAddressLine1).toBeNull();
      expect(prisma.trip.update).toHaveBeenCalled();
      const syncData = prisma.trip.update.mock.calls[0][0].data;
      expect(syncData.originLabel).toBe("JURONG — Jurong Port");
      expect(syncData.originLocationId).toBe("port1");
    });

    it("creates IMPORT job with pickupPortCode still succeeds", async () => {
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
            returningDepotAddress1: "Tuas Depot",
            },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      expect(prisma.job.create.mock.calls[0][0].data.pickupPortCode).toBe("JURONG");
    });

    it("creates IMPORT job with pickupAddress1 + pickupPostal and no pickupPortCode", async () => {
      const prisma = makeCreatePrisma();
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.IMPORT,
            pickupAddress1: "20 Tuas Ave 9",
            pickupPostal: "639201",
            pickupPlaceId: "ChIJ-import-pickup",
            importDetails: { returningDepotAddress1: "Tuas Depot" },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.pickupPortCode).toBeNull();
      const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
      expect(tripRows).toHaveLength(2);
      expect(tripRows.map((r: any) => r.jobTripTemplate)).toEqual([
        "PICKUP_TO_DELIVERY",
        "DELIVERY_TO_DEPOT",
      ]);
      expect(tripRows[0].originAddressLine1).toBe("20 Tuas Ave 9");
      expect(tripRows[0].originPostalCode).toBe("639201");
      expect(tripRows[0].originPlaceId).toBe("ChIJ-import-pickup");
    });

    it("IMPORT create with neither pickupPortCode nor pickup address fails", async () => {
      const prisma = makeCreatePrisma();
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.IMPORT,
            pickupAddress1: "   ",
            pickupPostal: "629356",
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).rejects.toThrow(/Import port \/ terminal is required/i);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });

    it("IMPORT create with autocomplete pickup and no pickupPortCode succeeds", async () => {
      const prisma = makeCreatePrisma();
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.IMPORT,
            pickupAddress1: "1 Harbour Drive",
            pickupPostal: "117352",
            pickupPlaceId: "ChIJ-import-pickup",
            importDetails: { returningDepotAddress1: "Tuas Depot" },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      expect(prisma.job.create.mock.calls[0][0].data.pickupPortCode).toBeNull();
      const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
      expect(tripRows[0].originAddressLine1).toBe("1 Harbour Drive");
      expect(tripRows[0].originPlaceId).toBe("ChIJ-import-pickup");
    });

    it("IMPORT create without return depot auto-pends empty-return Draft Trips", async () => {
      const prisma = makeCreatePrisma();
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.IMPORT,
            pickupAddress1: "1 Harbour Drive",
            pickupPostal: "117352",
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.returningDepotPending).toBe(true);
      expect(jobData.deliveryAddress1).toBe("8 Gul Cir");
      const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
      expect(tripRows).toHaveLength(2);
      expect(tripRows[0].destinationAddressLine1).toBe("8 Gul Cir");
      expect(tripRows[1].destinationAddressLine1 ?? null).toBeNull();
    });

    it("creates IMPORT address pickup with return and generates two trips", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockResolvedValue({
          code: "GUL",
          name: "Gul Depot",
          addressLine1: "7 Gul Circle",
          addressLine2: null,
          postalCode: "629563",
          placeId: null,
          lat: null,
          lng: null,
          type: "DEPOT",
          isActive: true,
        }),
      };
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.IMPORT,
            pickupAddress1: "1 Harbour Drive",
            pickupPostal: "117352",
            importDetails: {
              returningDepotCode: "GUL",
            },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
      expect(tripRows).toHaveLength(2);
      expect(tripRows[0].originAddressLine1).toBe("1 Harbour Drive");
      expect(tripRows[1].jobTripTemplate).toBe("DELIVERY_TO_DEPOT");
    });

    it("IMPORT create without return depot auto-pends even when port code is present", async () => {
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
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      expect(prisma.job.create.mock.calls[0][0].data.returningDepotPending).toBe(true);
    });

    it("creates IMPORT job with returnLastDay and return depot and generates two trips", async () => {
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
            returningDepotAddress1: "Tuas Depot",
              returnLastDay: "2026-06-30",
            },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.returningDepotCode).toBeNull();
      expect(jobData.returnLastDay).toEqual(new Date("2026-06-30"));
      expect(prisma.trip.createMany.mock.calls[0][0].data).toHaveLength(2);
    });

    it("creates IMPORT job with return location and generates port→delivery plus delivery→return trips", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.code === "JURONG" && where?.type === "PORT") {
            return Promise.resolve({ code: "JURONG", name: "Jurong Port", type: "PORT" });
          }
          if (where?.code === "GUL" && where?.type === "DEPOT") {
            return Promise.resolve({
              id: "loc-gul",
              code: "GUL",
              name: "Gul Depot",
              addressLine1: "7 Gul Circle",
              addressLine2: null,
              postalCode: "629563",
              placeId: null,
              lat: null,
              lng: null,
              type: "DEPOT",
              isActive: true,
            });
          }
          return Promise.resolve(null);
        }),
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
              returningDepotAddress1: "Tuas Depot",
              returningDepotCode: "GUL",
            },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.returningDepotCode).toBe("GUL");
      const tripRows = prisma.trip.createMany.mock.calls[0][0].data;
      expect(tripRows).toHaveLength(2);
    });

    it("RETURN create prefers master depot address over conflicting client address when code resolves", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockResolvedValue({
          code: "ACS1",
          name: "Allcontainer Services",
          addressLine1: "7 Gul Circle",
          addressLine2: null,
          postalCode: "629563",
          placeId: "ChIJ-acs1",
          lat: 1.3,
          lng: 103.7,
          type: "DEPOT",
          isActive: true,
        }),
      };
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.RETURN,
            pickupAddress1: "Customer yard",
            deliveryAddress1: "14 Pioneer Sector 2",
            importDetails: {
              returningDepotCode: "ACS1",
              returningDepotAddress1: "14 Pioneer Sector 2",
              returningDepotPostal: "628071",
            },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.returningDepotCode).toBe("ACS1");
      expect(jobData.deliveryAddress1).toBe("7 Gul Circle");
      expect(jobData.deliveryPostal).toBe("629563");
    });

    it("IMPORT create accepts ACS1 from MasterSingaporeDepot when logistics DEPOT is missing", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterSingaporeDepot = {
        findUnique: jest.fn().mockResolvedValue({
          code: "ACS1",
          addressLine1: "14 Pioneer Sector 2",
          addressLine2: null,
          postalCode: "628071",
          placeId: "ChIJ-acs1",
          lat: 1.31,
          lng: 103.69,
        }),
      };
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.code === "JURONG" && where?.type === "PORT") {
            return Promise.resolve({ code: "JURONG", name: "Jurong Port" });
          }
          return Promise.resolve(null);
        }),
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
              returningDepotCode: "ACS1",
              returningDepotAddress1: "14 Pioneer Sector 2",
            },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.returningDepotCode).toBe("ACS1");
      expect(prisma.masterSingaporeDepot.findUnique).toHaveBeenCalled();
    });

    it("IMPORT create rejects unknown returningDepotCode", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.code === "JURONG" && where?.type === "PORT") {
            return Promise.resolve({ code: "JURONG", name: "Jurong Port" });
          }
          return Promise.resolve(null);
        }),
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
              returningDepotCode: "NOPE",
              returningDepotAddress1: "Somewhere",
            },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).rejects.toThrow(/Unknown returningDepotCode: NOPE/);
      expect(prisma.job.create).not.toHaveBeenCalled();
    });

    it("IMPORT create still accepts logistics-only returningDepotCode (GUL fallback)", async () => {
      const prisma = makeCreatePrisma();
      prisma.masterLogisticsLocation = {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.code === "JURONG" && where?.type === "PORT") {
            return Promise.resolve({ code: "JURONG", name: "Jurong Port" });
          }
          if (where?.code === "GUL" && where?.type === "DEPOT") {
            return Promise.resolve({
              id: "loc-gul",
              code: "GUL",
              name: "Gul Depot",
              addressLine1: "7 Gul Circle",
              addressLine2: null,
              postalCode: "629563",
              placeId: null,
              lat: null,
              lng: null,
              type: "DEPOT",
              isActive: true,
            });
          }
          return Promise.resolve(null);
        }),
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
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      expect(prisma.job.create.mock.calls[0][0].data.returningDepotCode).toBe("GUL");
    });

    it("RETURN create keeps custom depot address when no depot code is supplied", async () => {
      const prisma = makeCreatePrisma();
      const svc = makeSvc(prisma);

      await expect(
        svc.create(
          "t1",
          {
            ...baseLclDto,
            jobType: JobType.RETURN,
            pickupAddress1: "Customer yard",
            deliveryAddress1: "15 Tuas Avenue 18",
            importDetails: {
              returningDepotCode: null,
              returningDepotAddress1: "15 Tuas Avenue 18",
              returningDepotPostal: "638905",
            },
          } as any,
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      const jobData = prisma.job.create.mock.calls[0][0].data;
      expect(jobData.returningDepotCode).toBeNull();
      expect(jobData.deliveryAddress1).toBe("15 Tuas Avenue 18");
      expect(jobData.deliveryPostal).toBe("638905");
    });
  });

  describe("TransportJobsService.update", () => {
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
          findMany: jest.fn().mockResolvedValue([{ id: "it1" }]),
          deleteMany: jobItemDeleteMany,
          createMany: jobItemCreateMany,
        },
        tripJobItem: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        jobTypeAssignment: {
          findMany: jest.fn().mockResolvedValue([{ jobType }]),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
          createMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
        $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) =>
          fn({
            job: {
              update: jest.fn().mockResolvedValue({ id: "job1" }),
              findFirst: jest.fn().mockResolvedValue(freshAfterUpdate()),
            },
            jobItem: {
              findMany: jest.fn().mockResolvedValue([{ id: "it1" }]),
              deleteMany: jobItemDeleteMany,
              createMany: jobItemCreateMany,
            },
            tripJobItem: {
              findMany: jest.fn().mockResolvedValue([]),
            },
            jobTypeAssignment: {
              findMany: jest.fn().mockResolvedValue([{ jobType }]),
              deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
              createMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
          }),
        ),
        jobItemDeleteMany,
        jobItemCreateMany,
      };
    }

    it("allows LCL PATCH with items: [] to clear cargo lines", async () => {
      const prisma = makeUpdatePrisma();
      const svc = new TransportJobsService(
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
          { userId: "u1", role: Role.TRANSPORT_STAFF },
        ),
      ).resolves.toBeTruthy();

      expect(prisma.jobItemDeleteMany).toHaveBeenCalled();
      expect(prisma.jobItemCreateMany).not.toHaveBeenCalled();
    });

    it("allows IMPORT PATCH with items: [] to clear cargo lines", async () => {
      const prisma = makeUpdatePrisma(JobType.IMPORT);
      const svc = new TransportJobsService(
        prisma as any,
        { log: jest.fn() } as any,
        {} as any,
      );
      jest.spyOn(svc as any, "attachTripAssignedDriverNamesForJobs").mockResolvedValue(undefined);

      await expect(
        svc.update("t1", "job1", { items: [] } as any, {
          userId: "u1",
          role: Role.TRANSPORT_STAFF,
        }),
      ).resolves.toBeTruthy();

      expect(prisma.jobItemDeleteMany).toHaveBeenCalled();
    });
  });
});
