import { JobType, Role } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";
import { InvoicesService } from "../finance/invoices.service";

describe("job charge workflow hardening", () => {
  it("create job ignores chargeSnapshot-like payload and does not persist charges", async () => {
    const jobChargeDeleteMany = jest.fn().mockResolvedValue({});
    const jobChargeCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-LCL",
          externalRef: null,
          jobType: JobType.LCL,
          status: "Draft",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-09T00:00:00.000Z"),
          pickupAddress1: "Pickup A",
          pickupAddress2: null,
          pickupPostal: null,
          pickupContactName: null,
          pickupContactPhone: null,
          deliveryAddress1: "Delivery A",
          deliveryAddress2: null,
          deliveryPostal: null,
          receiverName: "Receiver",
          receiverPhone: "123",
          assignedDriverId: null,
          assignedVehicleId: null,
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
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
        }),
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({
            id: "job1",
            tenantId: "t1",
            customerCompanyId: "comp1",
            internalRef: "WF-2026-04-0001-LCL",
            externalRef: null,
            jobType: JobType.LCL,
            status: "Draft",
            notes: null,
            createdByUserId: "u1",
            pickupDate: new Date("2026-04-09T00:00:00.000Z"),
            pickupAddress1: "Pickup A",
            pickupAddress2: null,
            pickupPostal: null,
            pickupContactName: null,
            pickupContactPhone: null,
            deliveryAddress1: "Delivery A",
            deliveryAddress2: null,
            deliveryPostal: null,
            receiverName: "Receiver",
            receiverPhone: "123",
            assignedDriverId: null,
            assignedVehicleId: null,
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
            customerCompany: { id: "comp1", name: "Customer A" },
            assignedDriver: null,
            createdBy: { id: "u1", name: "Ops User", email: "ops@example.com" },
            items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
            trips: [],
            charges: [],
            documents: [],
          }),
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn(async (input: any) => {
        if (typeof input === "function") {
          return input({
            jobCharge: { deleteMany: jobChargeDeleteMany, createMany: jobChargeCreateMany },
          });
        }
        return Promise.all(input);
      }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;

    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});

    await svc.create(
      "t1",
      {
        jobType: JobType.LCL,
        customerCompanyId: "comp1",
        pickupDate: "2026-04-09",
        pickupAddress1: "Pickup A",
        deliveryAddress1: "Delivery A",
        receiverName: "Receiver",
        receiverPhone: "123",
        items: [{ itemCode: "BOX", qty: 1 }],
        chargeSnapshot: {
          charges: [
            {
              sourceType: "CUSTOMER_QUOTATION",
              sourceRefId: "ql1",
              code: "A1",
              label: "Haulage",
              qty: 1,
              unitPriceCents: 12500,
              currency: "SGD",
              taxable: true,
              taxCode: "SR",
              taxRateBasisPoints: 900,
              sortOrder: 0,
            },
          ],
        },
      } as any,
      { userId: "u1", role: Role.OPS },
    );

    expect(jobChargeDeleteMany).not.toHaveBeenCalled();
    expect(jobChargeCreateMany).not.toHaveBeenCalled();
  });

  it("driver trip rate options for ops come from trucking dataset rows", async () => {
    const prisma: any = {
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue({ id: "ds-trucking" }),
      },
      masterRateDatasetRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "tm1",
            code: "TRIP-A",
            label: "Trip A",
            rateCents: 8000,
            currency: "SGD",
            isActive: true,
            hasMultipleRates: false,
            requiresManualAmount: false,
          },
        ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    const rows = await svc.listDriverTripRateMasters("t1");

    expect(rows).toEqual([
      {
        id: "tm1",
        code: "TRIP-A",
        label: "Trip A",
        rateCents: 8000,
        currency: "SGD",
        isActive: true,
        hasMultipleRates: false,
        requiresManualAmount: false,
      },
    ]);
    expect(prisma.masterRateDatasetRow.findMany).toHaveBeenCalled();
  });

  it("billing charge options resolve quotation rows from tenant quotation dataset", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          status: "Draft",
          charges: [],
        }),
      },
      masterRateDataset: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "ds-quote" })
          .mockResolvedValueOnce(null),
      },
      masterRateDatasetRow: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            { id: "qi1", code: "Q-1", label: "Haulage", isActive: true, sortOrder: 0 },
          ])
          .mockResolvedValueOnce([]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", {
      userId: "u1",
      role: Role.OPS,
    });

    expect(prisma.masterRateDatasetRow.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", datasetId: "ds-quote", isActive: true },
      orderBy: [{ sortOrder: "asc" }, { code: "asc" }, { id: "asc" }],
    });
    expect(result.quotationLines).toEqual([
      expect.objectContaining({
        id: "qi1",
        code: "Q-1",
        source: "TENANT_QUOTATION_DATASET",
      }),
    ]);
  });

  it("billing charge options resolve DHC refs from tenant DHC dataset with fixed/multiple/manual states", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          status: "Draft",
          charges: [],
        }),
      },
      masterRateDataset: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "ds-quote" })
          .mockResolvedValueOnce({ id: "ds-dhc" }),
      },
      masterRateDatasetRow: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              id: "d-fixed",
              code: "D1",
              label: "Fixed",
              rateCents: 8000,
              hasMultipleRates: false,
              requiresManualAmount: false,
            },
            {
              id: "d-multi",
              code: "D2",
              label: "Multi",
              rateCents: null,
              hasMultipleRates: true,
              rateOptionsJson: [
                { label: "Old", amountCents: 7000 },
                { label: "New", amountCents: 9000 },
              ],
              requiresManualAmount: false,
            },
            {
              id: "d-manual",
              code: "D3",
              label: "Manual",
              rateCents: null,
              hasMultipleRates: false,
              requiresManualAmount: true,
            },
          ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", {
      userId: "u1",
      role: Role.OPS,
    });

    expect(prisma.masterRateDatasetRow.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", datasetId: "ds-dhc", isActive: true },
      orderBy: { code: "asc" },
    });
    expect(result.dhcReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "d-fixed", rateCents: 8000, hasMultipleRates: false }),
        expect.objectContaining({ id: "d-multi", rateCents: null, hasMultipleRates: true }),
        expect.objectContaining({ id: "d-manual", rateCents: null, requiresManualAmount: true }),
      ]),
    );
  });

  it("create job accepts nested importDetails and maps to import routing fields", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.code === "JURONG" && where?.type === "PORT") {
            return Promise.resolve({ code: "JURONG", name: "Jurong Port", type: "PORT" });
          }
          if (where?.code === "GUL_DEFAULT" && where?.type === "DEPOT") {
            return Promise.resolve({ code: "GUL_DEFAULT", name: "Gul Depot", type: "DEPOT" });
          }
          return Promise.resolve(null);
        }),
      },
      masterSingaporePort: {
        findFirst: jest.fn().mockResolvedValue({ code: "JURONG" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-IMP",
          externalRef: null,
          jobType: JobType.IMPORT,
          status: "Draft",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-24T00:00:00.000Z"),
          pickupAddress1: "Jurong Port",
          pickupAddress2: null,
          pickupPostal: null,
          pickupContactName: null,
          pickupContactPhone: null,
          deliveryAddress1: "Addr",
          deliveryAddress2: null,
          deliveryPostal: null,
          receiverName: "Receiver",
          receiverPhone: "123",
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
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-IMP",
          externalRef: null,
          jobType: JobType.IMPORT,
          status: "Draft",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-24T00:00:00.000Z"),
          pickupAddress1: "Jurong Port",
          pickupAddress2: null,
          pickupPostal: null,
          pickupContactName: null,
          pickupContactPhone: null,
          deliveryAddress1: "Addr",
          deliveryAddress2: null,
          deliveryPostal: null,
          receiverName: "Receiver",
          receiverPhone: "123",
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
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          createdBy: { id: "u1", name: "Ops User", email: "ops@example.com" },
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
          trips: [],
          charges: [],
          documents: [],
        }),
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});

    await svc.create(
      "t1",
      {
        jobType: JobType.IMPORT,
        customerCompanyId: "comp1",
        pickupDate: "2026-04-24",
        pickupAddress1: "Jurong Port",
        deliveryAddress1: "Addr",
        receiverName: "Receiver",
        receiverPhone: "123",
        items: [{ itemCode: "BOX", qty: 1 }],
        importDetails: {
          pickupPortCode: "JURONG",
          portName: "Jurong Port",
          returningDepotCode: "GUL_DEFAULT",
        },
      } as any,
      { userId: "u1", role: Role.OPS },
    );

    const data = prisma.job.create.mock.calls[0][0].data;
    expect(data.pickupPortCode).toBe("JURONG");
    expect(data.portName).toBe("Jurong Port");
    expect(data.returningDepotCode).toBe("GUL_DEFAULT");
  });

  it("create job accepts nested exportDetails and maps export routing fields", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      masterLogisticsLocation: {
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where?.code === "PSA_DEPOT_A" && where?.type === "DEPOT") {
            return Promise.resolve({ code: "PSA_DEPOT_A", name: "PSA Depot A", type: "DEPOT" });
          }
          if (where?.code === "PSA_DEPOT_B" && where?.type === "DEPOT") {
            return Promise.resolve({ code: "PSA_DEPOT_B", name: "PSA Depot B", type: "DEPOT" });
          }
          return Promise.resolve(null);
        }),
      },
      masterSingaporeDepot: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ code: "PSA_DEPOT_A" })
          .mockResolvedValueOnce({ code: "PSA_DEPOT_B" }),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-EXP",
          externalRef: null,
          jobType: JobType.EXPORT,
          status: "Draft",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-24T00:00:00.000Z"),
          pickupAddress1: "Pickup A1",
          deliveryAddress1: "Stuffing A1",
          receiverName: "Stuffing PIC",
          receiverPhone: "99999999",
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
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
        }),
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          internalRef: "WF-2026-04-0001-EXP",
          externalRef: null,
          jobType: JobType.EXPORT,
          status: "Draft",
          notes: null,
          createdByUserId: "u1",
          pickupDate: new Date("2026-04-24T00:00:00.000Z"),
          pickupAddress1: "Pickup A1",
          deliveryAddress1: "Stuffing A1",
          receiverName: "Stuffing PIC",
          receiverPhone: "99999999",
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
          customerCompany: { id: "comp1", name: "Customer A" },
          assignedDriver: null,
          createdBy: { id: "u1", name: "Ops User", email: "ops@example.com" },
          items: [{ id: "i1", itemCode: "BOX", description: null, qty: 1 }],
          trips: [],
          charges: [],
          documents: [],
        }),
      },
      trip: {
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});

    await svc.create(
      "t1",
      {
        jobType: JobType.EXPORT,
        customerCompanyId: "comp1",
        pickupDate: "2026-04-24",
        pickupAddress1: "Legacy pickup",
        deliveryAddress1: "Legacy delivery",
        receiverName: "Legacy receiver",
        receiverPhone: "123",
        items: [{ itemCode: "BOX", qty: 1 }],
        exportDetails: {
          pickupDepotCode: "PSA_DEPOT_A",
          containerPickupAddress1: "Pickup A1",
          stuffingAddress1: "Stuffing A1",
          stuffingContactName: "Stuffing PIC",
          stuffingContactPhone: "99999999",
          returnDepotCode: "PSA_DEPOT_B",
          exportPortCode: "PSA",
        },
      } as any,
      { userId: "u1", role: Role.OPS },
    );

    const data = prisma.job.create.mock.calls[0][0].data;
    expect(data.exportOriginDepotCode).toBe("PSA_DEPOT_A");
    expect(data.returningDepotCode).toBe("PSA_DEPOT_B");
    expect(data.exportPortCode).toBe("PSA");
    expect(data.pickupAddress1).toBe("Pickup A1");
    expect(data.deliveryAddress1).toBe("Stuffing A1");
    expect(data.receiverName).toBe("Stuffing PIC");
    expect(data.receiverPhone).toBe("99999999");
  });

  it("invoice draft from jobs uses saved JobCharge rows and fails if any selected job has none", async () => {
    const prisma: any = {
      job: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            {
              id: "j1",
              internalRef: "JOB-1",
              receiverName: "Receiver",
              invoiceReadyAt: new Date("2026-04-20T00:00:00.000Z"),
              customerCompanyId: "comp1",
              customerCompany: { id: "comp1", name: "Customer A" },
              charges: [
                {
                  label: "Haulage",
                  qty: 1,
                  unitPriceCents: 10000,
                  taxable: true,
                  taxCode: "SR",
                  taxRateBasisPoints: 900,
                },
              ],
            },
            {
              id: "j2",
              internalRef: "JOB-2",
              receiverName: "Receiver",
              invoiceReadyAt: new Date("2026-04-20T00:00:00.000Z"),
              customerCompanyId: "comp1",
              customerCompany: { id: "comp1", name: "Customer A" },
              charges: [
                {
                  label: "Surcharge",
                  qty: 2,
                  unitPriceCents: 5000,
                  taxable: false,
                  taxCode: null,
                  taxRateBasisPoints: null,
                },
              ],
            },
          ])
          .mockResolvedValueOnce([
            {
              id: "j1",
              internalRef: "JOB-1",
              receiverName: "Receiver",
              invoiceReadyAt: new Date("2026-04-20T00:00:00.000Z"),
              customerCompanyId: "comp1",
              customerCompany: { id: "comp1", name: "Customer A" },
              charges: [
                {
                  label: "Haulage",
                  qty: 1,
                  unitPriceCents: 10000,
                  taxable: true,
                  taxCode: "SR",
                  taxRateBasisPoints: 900,
                },
              ],
            },
            {
              id: "j2",
              internalRef: "JOB-2",
              receiverName: "Receiver",
              invoiceReadyAt: new Date("2026-04-20T00:00:00.000Z"),
              customerCompanyId: "comp1",
              customerCompany: { id: "comp1", name: "Customer A" },
              charges: [],
            },
          ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new InvoicesService(prisma, supabaseService, audit);

    const ok = await svc.getInvoiceDraftFromJobs(
      "t1",
      ["j1", "j2"],
      { userId: "u1", role: Role.OPS },
    );
    expect(ok.sourceJobIds).toEqual(["j1", "j2"]);
    expect(ok.suggestedLineItems).toEqual([
      {
        description: "JOB-1 — Haulage",
        qty: 1,
        unitPriceCents: 10000,
        taxCode: "SR",
        taxRate: 900,
      },
      {
        description: "JOB-2 — Surcharge",
        qty: 2,
        unitPriceCents: 5000,
        taxCode: "ZR",
        taxRate: 0,
      },
    ]);

    await expect(
      svc.getInvoiceDraftFromJobs("t1", ["j1", "j2"], {
        userId: "u1",
        role: Role.OPS,
      }),
    ).rejects.toThrow(
      "Selected jobs must have saved JobCharge rows before invoicing. Missing charges for: JOB-2",
    );
  });

  it("publishTrip fails when DRAFT trip has no payout assigned", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: null,
          assignedDriverUserId: "u1",
        }),
        update: jest.fn(),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc1" }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.OPS }),
    ).rejects.toThrow("Driver payout is required before publishing a trip");
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("publishTrip moves DRAFT trip to PUBLISHED when payout exists", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: 7500,
          assignedDriverUserId: "u1",
        }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc1" }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.OPS });

    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({ status: "PUBLISHED", pendingState: "NONE" }),
    });
  });

  it("publishTrip fails when payout lines require manual amount", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: 7500,
          assignedDriverUserId: "u1",
        }),
        update: jest.fn(),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc1" }),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pl1",
            label: "Manual line",
            isSelectableForTripEarning: true,
            requiresManualAmount: true,
            amountCents: null,
          },
        ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    await expect(
      svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.OPS }),
    ).rejects.toThrow('Payout line "Manual line" requires manual amount before publish');
  });

  it("publishTrip succeeds when payout lines total is positive", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "DRAFT",
          driverEarningCents: null,
          assignedDriverUserId: "u1",
        }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
      },
      tripDocument: {
        findFirst: jest.fn().mockResolvedValue({ id: "doc1" }),
      },
      tripPayoutLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "pl1",
            label: "Line 1",
            isSelectableForTripEarning: true,
            requiresManualAmount: false,
            amountCents: 1500,
          },
          {
            id: "pl2",
            label: "Line 2",
            isSelectableForTripEarning: true,
            requiresManualAmount: false,
            amountCents: 2000,
          },
        ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.OPS });
    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({ status: "PUBLISHED" }),
    });
  });

  it("sendJobToInvoice validates trip completion gate", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: "Completed",
          invoiceReadyAt: null,
        }),
        update: jest.fn(),
      },
      trip: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ id: "t1", status: "ONGOING" }])
          .mockResolvedValueOnce([
            { id: "t1", status: "COMPLETED" },
            { id: "t2", status: "DONE" },
          ]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await expect(
      svc.sendJobToInvoice("t1", "job1", { userId: "u1", role: Role.OPS }),
    ).rejects.toThrow("Job must have at least one trip before sending to invoice");

    await expect(
      svc.sendJobToInvoice("t1", "job1", { userId: "u1", role: Role.OPS }),
    ).rejects.toThrow("All trips must be completed before sending job to invoice");

    await svc.sendJobToInvoice("t1", "job1", { userId: "u1", role: Role.OPS });

    expect(prisma.job.update).toHaveBeenCalled();
  });

  it("requires manual amount when quotation source row is marked requiresManualAmount", async () => {
    const jobChargeDeleteMany = jest.fn().mockResolvedValue({});
    const jobChargeCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          status: "Draft",
        }),
      },
      $transaction: jest.fn(async (input: any) => {
        if (typeof input === "function") {
          return input({
            masterRateDatasetRow: {
              findMany: jest.fn().mockResolvedValue([
                {
                  id: "ql-manual",
                  label: "Season Parking",
                  requiresManualAmount: true,
                },
              ]),
            },
            jobCharge: {
              deleteMany: jobChargeDeleteMany,
              createMany: jobChargeCreateMany,
            },
          });
        }
        return Promise.all(input);
      }),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    await expect(
      svc.saveJobCharges(
        "t1",
        "job1",
        {
          charges: [
            {
              sourceType: "CUSTOMER_QUOTATION",
              sourceRefId: "ql-manual",
              code: "E-1",
              label: "Season Parking",
              qty: 1,
              unitPriceCents: 0,
            },
          ],
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow(
      'Manual amount is required for quotation item "Season Parking" before saving charges',
    );
    expect(jobChargeDeleteMany).toHaveBeenCalled();
    expect(jobChargeCreateMany).not.toHaveBeenCalled();
  });

  it("patchTrip accepts valid selectable DRIVER_PAYOUT item id and updates earning", async () => {
    const tripFindFirst = jest.fn().mockResolvedValue({
      id: "trip1",
      tenantId: "t1",
      jobId: "job1",
    });
    const tripUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      trip: {
        findFirst: tripFindFirst,
        update: tripUpdate,
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: "cmo946tmb0001ku5ekac6in1g",
          label: "Normal full trip (20FT and 40FT)",
          rateCents: 9000,
          requiresManualAmount: false,
        }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.patchTrip(
      "t1",
      "job1",
      "trip1",
      { earningRateMasterId: "cmo946tmb0001ku5ekac6in1g" } as any,
      { userId: "u1", role: Role.OPS },
    );
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        payoutItemId: "cmo946tmb0001ku5ekac6in1g",
        earningRateMasterId: null,
        driverEarningCents: 9000,
      }),
    });
  });

  it("patchTrip fails when earningRateMasterId is a masterFile id", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
        }),
        update: jest.fn(),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { earningRateMasterId: "master_file_id_123" } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow("Driver trip rate master not found");
  });

  it("patchTrip fails for inactive or non-selectable payout item", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
        }),
        update: jest.fn(),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { earningRateMasterId: "inactive_or_nonselectable_item" } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow("Driver trip rate master not found");
  });

  it("patchTrip rejects selectable payout item requiring manual amount", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
        }),
        update: jest.fn(),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: "item-manual",
          label: "Manual",
          rateCents: null,
          requiresManualAmount: true,
        }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { earningRateMasterId: "item-manual" } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow(
      'Selected payout item "Manual" requires manual amount before assignment',
    );
  });

  it("rejects non-NONE pending state when trip is COMPLETED", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", status: "COMPLETED" }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    await expect(
      svc.updateTripPendingState(
        "t1",
        "job1",
        "trip1",
        "PENDING_AT_PORT" as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow(
      'pendingState "PENDING_AT_PORT" is invalid when trip status is COMPLETED. Allowed only for PUBLISHED or ONGOING',
    );
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("rejects non-NONE pending state when trip is DRAFT", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", status: "DRAFT" }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    await expect(
      svc.updateTripPendingState(
        "t1",
        "job1",
        "trip1",
        "PENDING_AT_DEPOT" as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow(
      'pendingState "PENDING_AT_DEPOT" is invalid when trip status is DRAFT. Allowed only for PUBLISHED or ONGOING',
    );
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("rejects non-NONE pending state when trip is DONE", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", status: "DONE" }),
        update: jest.fn(),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    await expect(
      svc.updateTripPendingState(
        "t1",
        "job1",
        "trip1",
        "PENDING_AT_PORT" as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow(
      'pendingState "PENDING_AT_PORT" is invalid when trip status is DONE. Allowed only for PUBLISHED or ONGOING',
    );
    expect(prisma.trip.update).not.toHaveBeenCalled();
  });

  it("markTripDone auto-clears pendingState to NONE", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", status: "COMPLETED" }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.markTripDone("t1", "job1", "trip1", { userId: "u1", role: Role.OPS });

    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: { status: "DONE", pendingState: "NONE" },
    });
  });

  it("getTripDetail maps IMPORT cargo as CONTAINER with containerCode", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          jobSequence: 1,
          tripSequence: 1,
          title: "Trip A",
          displayTitle: "Trip A",
          status: "PUBLISHED",
          pendingState: "NONE",
          plannedStartAt: null,
          startedAt: null,
          closedAt: null,
          createdAt: new Date(),
          createdByUserId: "u1",
          publishedAt: new Date(),
          publishedByUserId: "u1",
          assignedDriverUserId: "u1",
          vehicleId: null,
          fleetVehicleId: null,
          vehicles: null,
          fleetVehicle: null,
          documents: [],
          payoutLines: [],
          documentRequirements: [],
          completionRuleJson: null,
          driverEarningCents: null,
          earningRateMasterId: null,
          originLabel: "Port",
          destinationLabel: "Destination",
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WF-001",
            externalRef: null,
            jobType: "IMPORT",
            status: "Assigned",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: new Date(),
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops", email: "ops@example.com" },
            customerCompany: { name: "Customer A" },
            items: [{ id: "it1", itemCode: "CONT-001", description: "20FT", qty: 1 }],
          },
        }),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.OPS });
    expect(result.cargo.mode).toBe("CONTAINER");
    expect(result.cargo.containers[0].containerCode).toBe("CONT-001");
    expect(result.job.customerCompanyName).toBe("Customer A");
  });

  it("getTripDetail maps EXPORT cargo as CONTAINER with containerCode", async () => {
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
            internalRef: "WF-002",
            externalRef: null,
            jobType: "EXPORT",
            status: "Assigned",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: new Date(),
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops", email: "ops@example.com" },
            customerCompany: { name: "Customer B" },
            items: [{ id: "it1", itemCode: "CONT-EXP-01", description: null, qty: 1 }],
          },
        }),
      },
      tenantMembership: { findMany: jest.fn().mockResolvedValue([]) },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.OPS });
    expect(result.cargo.mode).toBe("CONTAINER");
    expect(result.cargo.containers[0].containerCode).toBe("CONT-EXP-01");
  });

  it("getTripDetail maps LCL cargo as ITEMS with itemCode and publish metadata", async () => {
    const now = new Date();
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          tenantId: "t1",
          jobId: "job1",
          status: "PUBLISHED",
          pendingState: "NONE",
          createdAt: now,
          createdByUserId: "u1",
          publishedAt: now,
          publishedByUserId: "u2",
          payoutItemId: "cmo946tmb0001ku5ekac6in1g",
          earningRateMasterId: null,
          documents: [],
          payoutLines: [],
          documentRequirements: [],
          assignedDriverUserId: null,
          job: {
            id: "job1",
            customerCompanyId: "c1",
            internalRef: "WF-003",
            externalRef: null,
            jobType: "LCL",
            status: "Assigned",
            receiverName: "Receiver",
            receiverPhone: "123",
            createdAt: now,
            createdByUserId: "u1",
            createdBy: { id: "u1", name: "Ops User", email: "ops@example.com" },
            customerCompany: { name: "Customer C" },
            items: [{ id: "it1", itemCode: "ITEM-001", description: "Box", qty: 3 }],
          },
        }),
      },
      tenantMembership: {
        findMany: jest.fn().mockResolvedValue([
          { userId: "u1", user: { id: "u1", name: "Ops User", email: "ops@example.com" } },
          { userId: "u2", user: { id: "u2", name: "Publisher", email: "pub@example.com" } },
        ]),
      },
      driverLocationLatest: { findUnique: jest.fn().mockResolvedValue(null) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    const result = await svc.getTripDetail("t1", "trip1", { role: Role.OPS });
    expect(result.cargo.mode).toBe("ITEMS");
    expect(result.cargo.items[0].itemCode).toBe("ITEM-001");
    expect(result.createdByName).toBe("Ops User");
    expect(result.publishedByName).toBe("Publisher");
    expect(result.publishedAt).toEqual(now);
    expect(result.payout.earningRateMasterId).toBe("cmo946tmb0001ku5ekac6in1g");
  });

  it("saveTripPayoutDraft saves one selected master payout line", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
        update: tripUpdate,
      },
      tripPayoutLine: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: "cmo946tmb0001ku5ekac6in1g",
          label: "Normal full trip (20FT and 40FT)",
          rateCents: 5000,
          requiresManualAmount: false,
        }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.saveTripPayoutDraft(
      "t1",
      "job1",
      "trip1",
      {
        earningRateMasterId: "cmo946tmb0001ku5ekac6in1g",
        payoutLines: [
          {
            sourceRateMasterItemId: "cmo946tmb0001ku5ekac6in1g",
            label: "Line 1",
            quantity: 1,
            amountCents: 5000,
            totalCents: 5000,
            isManual: false,
          } as any,
        ],
      } as any,
      { userId: "u1", role: Role.OPS },
    );
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        payoutItemId: "cmo946tmb0001ku5ekac6in1g",
        earningRateMasterId: null,
        driverEarningCents: 5000,
      }),
    });
  });

  it("saveTripPayoutDraft supports multiple lines and sums total", async () => {
    const tripUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
        update: tripUpdate,
      },
      tripPayoutLine: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      driverPayoutItem: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.saveTripPayoutDraft(
      "t1",
      "job1",
      "trip1",
      {
        earningRateMasterId: null,
        payoutLines: [
          { label: "L1", quantity: 1, amountCents: 1000, totalCents: 1000, isManual: true } as any,
          { label: "L2", quantity: 2, amountCents: 2000, totalCents: 4000, isManual: true } as any,
        ],
      } as any,
      { userId: "u1", role: Role.OPS },
    );
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({ driverEarningCents: 5000 }),
    });
  });

  it("saveTripPayoutDraft supports manual line save", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
        update: jest.fn().mockResolvedValue({}),
      },
      tripPayoutLine: {
        deleteMany: jest.fn().mockResolvedValue({}),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      driverPayoutItem: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await expect(
      svc.saveTripPayoutDraft(
        "t1",
        "job1",
        "trip1",
        {
          earningRateMasterId: null,
          payoutLines: [{ label: "Manual", quantity: 1, amountCents: 1500, totalCents: 1500, isManual: true }] as any,
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).resolves.toBeTruthy();
  });

  it("saveTripPayoutDraft fails invalid sourceRateMasterItemId", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
      },
      driverPayoutItem: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    await expect(
      svc.saveTripPayoutDraft(
        "t1",
        "job1",
        "trip1",
        {
          earningRateMasterId: null,
          payoutLines: [{ sourceRateMasterItemId: "bad", label: "Bad", quantity: 1, amountCents: 1, totalCents: 1 }] as any,
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow("Invalid sourceRateMasterItemId");
  });

  it("saveTripPayoutDraft fails for non-selectable source item", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
      },
      driverPayoutItem: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    await expect(
      svc.saveTripPayoutDraft(
        "t1",
        "job1",
        "trip1",
        {
          earningRateMasterId: null,
          payoutLines: [{ sourceRateMasterItemId: "non-selectable", label: "Bad", quantity: 1, amountCents: 1, totalCents: 1 }] as any,
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow("Invalid sourceRateMasterItemId");
  });

  it("saveTripPayoutDraft requires amountCents for requiresManualAmount source item", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip1", tenantId: "t1", jobId: "job1" }),
      },
      driverPayoutItem: {
        findFirst: jest.fn().mockResolvedValue({
          id: "manual-source",
          label: "Manual source",
          rateCents: null,
          requiresManualAmount: true,
        }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    await expect(
      svc.saveTripPayoutDraft(
        "t1",
        "job1",
        "trip1",
        {
          earningRateMasterId: null,
          payoutLines: [{ sourceRateMasterItemId: "manual-source", label: "Manual", quantity: 1, totalCents: 10 }] as any,
        } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow("requires amountCents");
  });
});
