import { JobType, Role } from "@prisma/client";
import { OpsJobsService } from "./ops-jobs.service";
import { InvoicesService } from "../finance/invoices.service";

describe("job charge workflow hardening", () => {
  it("create job persists frozen JobCharge rows from chargeSnapshot", async () => {
    const jobChargeDeleteMany = jest.fn().mockResolvedValue({});
    const jobChargeCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const quotationItemFindMany = jest.fn().mockResolvedValue([
      {
        id: "ql1",
        masterFileId: "mf1",
        section: "ANNEX A",
        code: "A1",
        label: "Haulage",
        description: "Container haulage",
        unit: "trip",
        notes: "Customer quotation note",
        masterFile: {
          id: "mf1",
          customerCompanyId: "comp1",
          isActive: true,
          uploadedAt: new Date("2026-04-09T00:00:00.000Z"),
        },
      },
    ]);
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
            charges: [
              {
                id: "jc1",
                sourceType: "CUSTOMER_QUOTATION",
                sourceRefId: "ql1",
                code: "A1",
                label: "Haulage",
                description: null,
                qty: 1,
                unitPriceCents: 12500,
                amountCents: 12500,
                currency: "SGD",
                taxable: true,
                taxCode: "SR",
                taxRateBasisPoints: 900,
                sortOrder: 0,
              },
            ],
            documents: [],
          }),
      },
      trip: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
      $transaction: jest.fn(async (input: any) => {
        if (typeof input === "function") {
          return input({
            customerQuotationItem: { findMany: quotationItemFindMany },
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

    expect(jobChargeDeleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", jobId: "job1" },
    });
    expect(jobChargeCreateMany).toHaveBeenCalled();
    expect(quotationItemFindMany).toHaveBeenCalled();
    const createManyArgs = jobChargeCreateMany.mock.calls[0][0];
    expect(createManyArgs.data[0]).toMatchObject({
      tenantId: "t1",
      jobId: "job1",
      sourceType: "CUSTOMER_QUOTATION",
      sourceRefId: "ql1",
      sourceCustomerQuotationItemId: "ql1",
      code: "A1",
      label: "Haulage",
      description: "Container haulage",
      qty: 1,
      unitPriceCents: 12500,
      amountCents: 12500,
      currency: "SGD",
      taxable: true,
      taxCode: "SR",
      taxRateBasisPoints: 900,
      sortOrder: 0,
      selectedByUserId: "u1",
    });
    expect(createManyArgs.data[0].metadataJson?.quotationSnapshot).toMatchObject({
      sourceCustomerQuotationItemId: "ql1",
      section: "ANNEX A",
      code: "A1",
      label: "Haulage",
      description: "Container haulage",
      unit: "trip",
      selectedRateCents: 12500,
      selectedAmountCents: 12500,
      notes: "Customer quotation note",
    });
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
});
