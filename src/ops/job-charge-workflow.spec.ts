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
      trip: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
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
    jest.spyOn(svc as any, "generateDoDocument").mockResolvedValue({});

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
      driverTripRateMaster: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "tm1",
            code: "TRIP-A",
            label: "Trip A",
            amountCents: 8000,
            currency: "SGD",
            active: true,
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
        amountCents: 8000,
        currency: "SGD",
        active: true,
        hasMultipleRates: false,
        requiresManualAmount: false,
      },
    ]);
    expect(prisma.driverTripRateMaster.findMany).toHaveBeenCalled();
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
      tenantQuotationItem: {
        findMany: jest.fn().mockResolvedValue([
          { id: "qi1", code: "Q-1", label: "Haulage", active: true, sortOrder: 0 },
        ]),
      },
      masterFile: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      dhcReferenceItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      depotHandlingReference: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", {
      userId: "u1",
      role: Role.OPS,
    });

    expect(prisma.tenantQuotationItem.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", active: true },
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
      tenantQuotationItem: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      depotHandlingReference: {
        findMany: jest.fn().mockResolvedValue([
          { id: "d-fixed", code: "D1", label: "Fixed", amountCents: 8000, hasMultipleRates: false, requiresManualAmount: false },
          { id: "d-multi", code: "D2", label: "Multi", amountCents: null, hasMultipleRates: true, rateOptionsJson: [{ label: "Old", amountCents: 7000 }, { label: "New", amountCents: 9000 }], requiresManualAmount: false },
          { id: "d-manual", code: "D3", label: "Manual", amountCents: null, hasMultipleRates: false, requiresManualAmount: true },
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

    expect(prisma.depotHandlingReference.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", active: true },
      orderBy: { code: "asc" },
    });
    expect(result.dhcReferences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "d-fixed", amountCents: 8000, hasMultipleRates: false }),
        expect.objectContaining({ id: "d-multi", amountCents: null, hasMultipleRates: true }),
        expect.objectContaining({ id: "d-manual", amountCents: null, requiresManualAmount: true }),
      ]),
    );
  });

  it("create job accepts nested importDetails and maps to import routing fields", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
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
      trip: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "generateDoDocument").mockResolvedValue({});

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
      trip: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc as any, "generateDoDocument").mockResolvedValue({});

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

  it("publishTrip fails when draft trip has no payout assigned", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "Draft",
          driverEarningCents: null,
        }),
        update: jest.fn(),
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

  it("publishTrip moves draft trip to Planned when payout exists", async () => {
    const prisma: any = {
      trip: {
        findFirst: jest.fn().mockResolvedValue({
          id: "trip1",
          status: "Draft",
          driverEarningCents: 7500,
        }),
        update: jest.fn().mockResolvedValue({ id: "trip1" }),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.publishTrip("t1", "job1", "trip1", { userId: "u1", role: Role.OPS });

    expect(prisma.trip.update).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: { status: "Planned" },
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
          .mockResolvedValueOnce([{ id: "t1", status: "InTransit" }])
          .mockResolvedValueOnce([
            { id: "t1", status: "Delivered" },
            { id: "t2", status: "Closed" },
          ]),
      },
      tenantQuotationItem: { findMany: jest.fn() },
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
    expect(prisma.tenantQuotationItem.findMany).not.toHaveBeenCalled();
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
            tenantQuotationItem: {
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

  it("patchTrip resolves trucking rate behavior for fixed/multiple/manual rows", async () => {
    const tripFindFirst = jest.fn().mockResolvedValue({
      id: "trip1",
      tenantId: "t1",
      jobId: "job1",
    });
    const tripUpdate = jest.fn().mockResolvedValue({});
    const driverTripRateFindFirst = jest
      .fn()
      .mockResolvedValueOnce({
        id: "m-fixed",
        label: "Fixed",
        amountCents: 9000,
        hasMultipleRates: false,
        requiresManualAmount: false,
      })
      .mockResolvedValueOnce({
        id: "m-multi",
        label: "Multi",
        amountCents: null,
        hasMultipleRates: true,
        defaultRateOptionIndex: null,
        requiresManualAmount: false,
      })
      .mockResolvedValueOnce({
        id: "m-manual",
        label: "Manual",
        amountCents: null,
        hasMultipleRates: false,
        requiresManualAmount: true,
      });
    const prisma: any = {
      trip: {
        findFirst: tripFindFirst,
        update: tripUpdate,
      },
      driverTripRateMaster: {
        findFirst: driverTripRateFindFirst,
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
      { earningRateMasterId: "m-fixed" } as any,
      { userId: "u1", role: Role.OPS },
    );
    expect(tripUpdate).toHaveBeenCalledWith({
      where: { id: "trip1" },
      data: expect.objectContaining({
        earningRateMasterId: "m-fixed",
        driverEarningCents: 9000,
      }),
    });

    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { earningRateMasterId: "m-multi" } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow("requires manual/default rate selection");

    await expect(
      svc.patchTrip(
        "t1",
        "job1",
        "trip1",
        { earningRateMasterId: "m-manual" } as any,
        { userId: "u1", role: Role.OPS },
      ),
    ).rejects.toThrow("requires manual/default rate selection");
  });
});
