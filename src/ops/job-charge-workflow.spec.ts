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

  it("driver trip rate options for ops use tenant payout master file rows when active", async () => {
    const prisma: any = {
      masterFile: {
        findFirst: jest.fn().mockResolvedValue({ id: "mf-driver" }),
      },
      driverPayoutItem: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "dp1",
            code: "TRIP-A",
            label: "Trip A",
            rateCents: 8000,
          },
        ]),
      },
      driverTripRateMaster: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) } as any;
    const supabaseService = { getClient: jest.fn() } as any;
    const svc = new OpsJobsService(prisma, audit, supabaseService);

    const rows = await svc.listDriverTripRateMasters("t1");

    expect(rows).toEqual([
      {
        id: "dp1",
        code: "TRIP-A",
        label: "Trip A",
        amountCents: 8000,
        currency: "SGD",
        active: true,
        sourceType: "MASTER_FILE_DRIVER_PAYOUT",
      },
    ]);
    expect(prisma.driverTripRateMaster.findMany).not.toHaveBeenCalled();
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
            customerQuotationItem: {
              findMany: jest.fn().mockResolvedValue([
                {
                  id: "ql-manual",
                  label: "Season Parking",
                  requiresManualAmount: true,
                  masterFile: { customerCompanyId: "comp1" },
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
});
