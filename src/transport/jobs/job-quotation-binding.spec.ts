import {
  CustomerQuotationStatus,
  CustomerRateTemplateStatus,
  JobStatus,
  JobType,
  Role,
} from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";
import { withInteractiveTransaction } from "../test-utils/prisma-interactive-transaction.mock";

const actor = { userId: "u1", role: Role.TRANSPORT_STAFF };

function acceptedQuotation(overrides: Record<string, unknown> = {}) {
  return {
    id: "q-accepted",
    tenantId: "t1",
    customerCompanyId: "comp1",
    quotationNo: "QT-202608-0001",
    title: "Standard Transport Rates",
    status: CustomerQuotationStatus.ACCEPTED,
    ...overrides,
  };
}

function ongoingJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "job1",
    tenantId: "t1",
    customerCompanyId: "comp1",
    sourceCustomerQuotationId: null,
    status: JobStatus.ONGOING,
    charges: [],
    ...overrides,
  };
}

describe("Job commercial quotation binding", () => {
  it("binds an ACCEPTED quotation belonging to the same customer on create", async () => {
    const prisma: any = withInteractiveTransaction({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(acceptedQuotation()),
      },
      job_internal_ref_counters: {
        upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
      },
      job: {
        create: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          customerCompanyId: "comp1",
          sourceCustomerQuotationId: "q-accepted",
          internalRef: "WFL-2026-08-0001-LCL",
          jobType: JobType.LCL,
          status: JobStatus.ONGOING,
        }),
        findFirst: jest.fn().mockResolvedValue({
          ...ongoingJob({ sourceCustomerQuotationId: "q-accepted" }),
          customerCompany: { id: "comp1", name: "Acme" },
          sourceCustomerQuotation: acceptedQuotation(),
          assignedDriver: null,
          createdBy: null,
          items: [],
          trips: [],
          charges: [],
          documents: [],
        }),
      },
      trip: { createMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([]) },
      jobItem: {
        create: jest.fn().mockResolvedValue({
          id: "item1",
          itemCode: "BOX",
          description: null,
          sealNo: null,
          pickupReference: null,
          qty: 1,
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "item1",
            itemCode: "BOX",
            description: null,
            sealNo: null,
            pickupReference: null,
            qty: 1,
          },
        ]),
      },
      tripJobItem: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc as any, "generateTripDeliveryDoDocument").mockResolvedValue({});

    const created = await svc.create(
      "t1",
      {
        jobType: JobType.LCL,
        customerCompanyId: "comp1",
        sourceCustomerQuotationId: "q-accepted",
        pickupAddress1: "A",
        deliveryAddress1: "B",
        receiverName: "R",
        receiverPhone: "1",
        items: [{ itemCode: "BOX", qty: 1 }],
      } as any,
      actor,
    );

    expect(prisma.customerQuotation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "q-accepted", tenantId: "t1" },
      }),
    );
    expect(prisma.job.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sourceCustomerQuotationId: "q-accepted",
        }),
      }),
    );
    expect(created.sourceCustomerQuotationId).toBe("q-accepted");
    expect(prisma.jobCharge?.createMany).toBeUndefined();
  });

  it.each([
    CustomerQuotationStatus.DRAFT,
    CustomerQuotationStatus.ISSUED,
    CustomerQuotationStatus.REJECTED,
    CustomerQuotationStatus.VOID,
    CustomerQuotationStatus.EXPIRED,
    CustomerQuotationStatus.CANCELLED,
  ])("rejects %s quotations", async (status) => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(acceptedQuotation({ status })),
      },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.LCL,
          customerCompanyId: "comp1",
          sourceCustomerQuotationId: "q-accepted",
          pickupAddress1: "A",
          deliveryAddress1: "B",
          receiverName: "R",
          receiverPhone: "1",
          items: [{ itemCode: "BOX", qty: 1 }],
        } as any,
        actor,
      ),
    ).rejects.toThrow("ACCEPTED");
  });

  it("rejects another customer's quotation", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      customerQuotation: {
        findFirst: jest
          .fn()
          .mockResolvedValue(acceptedQuotation({ customerCompanyId: "comp-other" })),
      },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.LCL,
          customerCompanyId: "comp1",
          sourceCustomerQuotationId: "q-accepted",
          pickupAddress1: "A",
          deliveryAddress1: "B",
          receiverName: "R",
          receiverPhone: "1",
          items: [{ itemCode: "BOX", qty: 1 }],
        } as any,
        actor,
      ),
    ).rejects.toThrow("does not belong to this customer");
  });

  it("rejects a quotation from another tenant", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    await expect(
      svc.create(
        "t1",
        {
          jobType: JobType.LCL,
          customerCompanyId: "comp1",
          sourceCustomerQuotationId: "q-other-tenant",
          pickupAddress1: "A",
          deliveryAddress1: "B",
          receiverName: "R",
          receiverPhone: "1",
          items: [{ itemCode: "BOX", qty: 1 }],
        } as any,
        actor,
      ),
    ).rejects.toThrow("Customer quotation not found");
  });

  it("clears an incompatible quotation when the job customer changes", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue(
          ongoingJob({ sourceCustomerQuotationId: "q-accepted" }),
        ),
        update: jest.fn().mockResolvedValue(
          ongoingJob({ customerCompanyId: "comp2", sourceCustomerQuotationId: null }),
        ),
      },
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp2", tenantId: "t1" }),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.update("t1", "job1", { customerCompanyId: "comp2" } as any, actor);
    expect(prisma.job.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerCompanyId: "comp2",
          sourceCustomerQuotationId: null,
        }),
      }),
    );
  });

  it("allows the same accepted quotation on multiple jobs", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "comp1", tenantId: "t1" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(acceptedQuotation()),
      },
      job: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(ongoingJob({ id: "job-a" }))
          .mockResolvedValueOnce(ongoingJob({ id: "job-a" }))
          .mockResolvedValueOnce(ongoingJob({ id: "job-b" }))
          .mockResolvedValueOnce(ongoingJob({ id: "job-b" })),
        update: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job" } as any);

    await svc.update(
      "t1",
      "job-a",
      { sourceCustomerQuotationId: "q-accepted" } as any,
      actor,
    );
    await svc.update(
      "t1",
      "job-b",
      { sourceCustomerQuotationId: "q-accepted" } as any,
      actor,
    );
    expect(prisma.job.update).toHaveBeenCalledTimes(2);
  });
});

describe("Job billing charge options", () => {
  it("uses bound CustomerQuotation lines and does not read the tenant quotation base", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          ...ongoingJob({ sourceCustomerQuotationId: "q-accepted" }),
          sourceCustomerQuotation: acceptedQuotation(),
        }),
      },
      customerQuotationLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "line-1",
            code: "A1",
            label: "Haulage",
            qty: 1,
            unitPriceCents: 12500,
            taxRate: 900,
            taxCode: "SR",
          },
        ]),
      },
      customerRateTemplate: { findFirst: jest.fn() },
      masterRateDataset: { findFirst: jest.fn().mockResolvedValue(null) },
      masterRateDatasetRow: { findMany: jest.fn() },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.quotationSource).toBe("CUSTOMER_QUOTATION");
    expect(result.quotationLines).toEqual([
      expect.objectContaining({
        id: "line-1",
        source: "CUSTOMER_QUOTATION",
        quotationNo: "QT-202608-0001",
      }),
    ]);
    expect(prisma.customerQuotationLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          quotationId: "q-accepted",
        }),
      }),
    );
    expect(prisma.customerRateTemplate.findFirst).not.toHaveBeenCalled();
    expect(prisma.masterRateDataset.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ type: "DHC_RATES" }),
      }),
    );
  });

  it("falls back to the customer's ACTIVE rate template when unbound and no accepted quotation exists", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue(ongoingJob()),
      },
      customerQuotation: { findMany: jest.fn().mockResolvedValue([]) },
      customerRateTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: "tmpl-1",
          name: "Default rate template",
          rows: [
            { id: "row-1", code: "R1", label: "Default haulage", rateCents: 9000 },
          ],
        }),
      },
      masterRateDataset: { findFirst: jest.fn().mockResolvedValue(null) },
      masterRateDatasetRow: { findMany: jest.fn() },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.quotationSource).toBe("NONE");
    expect(result.legacyTemplate?.lines[0]).toMatchObject({
      id: "row-1",
      source: "CUSTOMER_RATE_TEMPLATE",
    });
    expect(result.quotationLines).toEqual([]);
    expect(prisma.customerRateTemplate.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          customerCompanyId: "comp1",
          status: CustomerRateTemplateStatus.ACTIVE,
        }),
      }),
    );
  });

  it("keeps DHC options separate from quotation lines", async () => {
    const prisma: any = {
      job: { findFirst: jest.fn().mockResolvedValue(ongoingJob()) },
      customerQuotation: { findMany: jest.fn().mockResolvedValue([]) },
      customerRateTemplate: { findFirst: jest.fn().mockResolvedValue(null) },
      masterRateDataset: { findFirst: jest.fn().mockResolvedValue({ id: "ds-dhc" }) },
      masterRateDatasetRow: {
        findMany: jest.fn().mockResolvedValue([
          { id: "d1", code: "D1", label: "Detention", rateCents: 5000 },
        ]),
      },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.quotationLines).toEqual([]);
    expect(result.dhcReferences).toEqual([
      expect.objectContaining({ id: "d1", source: "DHC_REFERENCE" }),
    ]);
  });

  it("exposes saved charge provenance without raw ids, including legacy master rows", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue({
          ...ongoingJob({ sourceCustomerQuotationId: "q-accepted" }),
          sourceCustomerQuotation: acceptedQuotation(),
          charges: [
            {
              id: "jc-new",
              sourceType: "CUSTOMER_QUOTATION",
              sourceCustomerQuotationLineId: "line-1",
              metadataJson: {
                quotationSnapshot: { quotationNo: "QT-202608-0001" },
              },
              label: "Haulage",
              qty: 1,
              unitPriceCents: 12500,
              amountCents: 12500,
            },
            {
              id: "jc-legacy",
              sourceType: "CUSTOMER_QUOTATION",
              sourceRefId: "master-row-old",
              sourceCustomerQuotationLineId: null,
              metadataJson: null,
              label: "Old haulage",
              qty: 1,
              unitPriceCents: 8000,
              amountCents: 8000,
            },
          ],
        }),
      },
      customerQuotationLine: { findMany: jest.fn().mockResolvedValue([]) },
      masterRateDataset: { findFirst: jest.fn().mockResolvedValue(null) },
      masterRateDatasetRow: { findMany: jest.fn() },
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );
    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.existingSnapshot).toEqual([
      expect.objectContaining({
        id: "jc-new",
        provenanceLabel: "From QT-202608-0001",
      }),
      expect.objectContaining({
        id: "jc-legacy",
        provenanceLabel: "Legacy master rate",
      }),
    ]);
  });
});

describe("JobCharge quotation snapshots", () => {
  function savePrisma(txExtra: Record<string, unknown> = {}) {
    const jobChargeCreateMany = jest.fn().mockResolvedValue({ count: 1 });
    const jobChargeDeleteMany = jest.fn().mockResolvedValue({});
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue(
          ongoingJob({ sourceCustomerQuotationId: "q-accepted" }),
        ),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          jobCharge: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jobChargeDeleteMany,
            createMany: jobChargeCreateMany,
          },
          invoiceChargeReservation: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          customerQuotationLine: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: "line-1",
                code: "A1",
                label: "Haulage",
                description: "Move",
                unitPriceCents: 12500,
                currency: "SGD",
                taxCode: "SR",
                taxRate: 900,
                requiresManualAmount: false,
                quotation: acceptedQuotation(),
              },
            ]),
          },
          customerRateTemplateRow: { findMany: jest.fn().mockResolvedValue([]) },
          ...txExtra,
        }),
      ),
    };
    return { prisma, jobChargeCreateMany, jobChargeDeleteMany };
  }

  it("snapshots selected quotation line values and line id", async () => {
    const { prisma, jobChargeCreateMany } = savePrisma();
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);

    await svc.saveJobCharges(
      "t1",
      "job1",
      {
        charges: [
          {
            sourceType: "CUSTOMER_QUOTATION",
            sourceCustomerQuotationLineId: "line-1",
            sourceRefId: "line-1",
            code: "ignored",
            label: "ignored",
            qty: 2,
            unitPriceCents: 12500,
          },
        ],
      } as any,
      actor,
    );

    expect(jobChargeCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceType: "CUSTOMER_QUOTATION",
          sourceCustomerQuotationLineId: "line-1",
          code: "A1",
          label: "Haulage",
          qty: 2,
          unitPriceCents: 12500,
          amountCents: 25000,
        }),
      ],
    });
  });

  it("rejects a line from another quotation", async () => {
    const { prisma, jobChargeCreateMany } = savePrisma({
      customerQuotationLine: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    await expect(
      svc.saveJobCharges(
        "t1",
        "job1",
        {
          charges: [
            {
              sourceType: "CUSTOMER_QUOTATION",
              sourceCustomerQuotationLineId: "line-from-qt-002",
              code: "X",
              label: "X",
              qty: 1,
              unitPriceCents: 100,
            },
          ],
        } as any,
        actor,
      ),
    ).rejects.toThrow("does not belong to the job's bound quotation");
    expect(jobChargeCreateMany).not.toHaveBeenCalled();
  });

  it("saves manual and DHC charges without quotation line ids", async () => {
    const { prisma, jobChargeCreateMany } = savePrisma();
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.saveJobCharges(
      "t1",
      "job1",
      {
        charges: [
          {
            sourceType: "DHC_REFERENCE",
            sourceRefId: "d1",
            code: "D1",
            label: "Detention",
            qty: 1,
            unitPriceCents: 5000,
          },
          {
            sourceType: "MANUAL",
            code: "M1",
            label: "Extra wait",
            qty: 1,
            unitPriceCents: 2000,
          },
        ],
      } as any,
      actor,
    );
    expect(jobChargeCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceType: "DHC_REFERENCE",
          sourceCustomerQuotationLineId: null,
          amountCents: 5000,
        }),
        expect.objectContaining({
          sourceType: "MANUAL",
          sourceCustomerQuotationLineId: null,
          amountCents: 2000,
        }),
      ],
    });
  });

  it("keeps the submitted unit price even if the quotation line price later differs", async () => {
    const { prisma, jobChargeCreateMany } = savePrisma({
      customerQuotationLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "line-1",
            code: "A1",
            label: "Haulage",
            description: "Move",
            unitPriceCents: 99_999,
            currency: "SGD",
            taxCode: "SR",
            taxRate: 900,
            requiresManualAmount: false,
            quotation: acceptedQuotation(),
          },
        ]),
      },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.saveJobCharges(
      "t1",
      "job1",
      {
        charges: [
          {
            sourceType: "CUSTOMER_QUOTATION",
            sourceCustomerQuotationLineId: "line-1",
            code: "A1",
            label: "Haulage",
            qty: 1,
            unitPriceCents: 12500,
          },
        ],
      } as any,
      actor,
    );
    expect(jobChargeCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          unitPriceCents: 12500,
          amountCents: 12500,
        }),
      ],
    });
    expect(prisma.masterRateDatasetRow).toBeUndefined();
  });

  it("re-saves historical CUSTOMER_QUOTATION rows that only have a master sourceRefId", async () => {
    const { prisma, jobChargeCreateMany } = savePrisma();
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    jest.spyOn(svc, "getOne").mockResolvedValue({ id: "job1" } as any);
    await svc.saveJobCharges(
      "t1",
      "job1",
      {
        charges: [
          {
            sourceType: "CUSTOMER_QUOTATION",
            sourceRefId: "master-row-old",
            code: "LEGACY",
            label: "Old master haulage",
            qty: 1,
            unitPriceCents: 8000,
          },
        ],
      } as any,
      actor,
    );
    expect(jobChargeCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sourceType: "CUSTOMER_QUOTATION",
          sourceRefId: "master-row-old",
          sourceCustomerQuotationLineId: null,
          unitPriceCents: 8000,
          amountCents: 8000,
        }),
      ],
    });
  });

  it("rejects deleting or editing a JobCharge reserved on an invoice", async () => {
    const reserved = {
      id: "jc-reserved",
      label: "Trucking",
      qty: 1,
      unitPriceCents: 10000,
      code: "TRK",
    };
    const { prisma } = savePrisma({
      jobCharge: {
        findMany: jest.fn().mockResolvedValue([reserved]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      invoiceChargeReservation: {
        findMany: jest.fn().mockResolvedValue([{ jobChargeId: "jc-reserved" }]),
      },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn().mockResolvedValue(undefined) } as any,
      { getClient: jest.fn() } as any,
    );
    await expect(
      svc.saveJobCharges(
        "t1",
        "job1",
        { charges: [] } as any,
        actor,
      ),
    ).rejects.toThrow("reserved on an invoice");
  });
});
