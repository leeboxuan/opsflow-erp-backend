import {
  CustomerQuotationStatus,
  CustomerRateTemplateStatus,
  JobStatus,
  Role,
} from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";

const actor = { userId: "u1", role: Role.TRANSPORT_STAFF };

function acceptedQuotation(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    tenantId: "t1",
    customerCompanyId: "comp1",
    quotationNo: id === "q-a" ? "QT-202608-0001" : "QT-202608-0002",
    title: id === "q-a" ? "Site works" : "Container haulage",
    status: CustomerQuotationStatus.ACCEPTED,
    acceptedAt: new Date(id === "q-a" ? "2026-08-01" : "2026-08-10"),
    validUntil: new Date("2026-12-31"),
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

function cataloguePrisma(input: {
  accepted?: Array<ReturnType<typeof acceptedQuotation>>;
  linesByQuotation?: Record<string, Array<Record<string, unknown>>>;
  template?: Record<string, unknown> | null;
  job?: Record<string, unknown>;
}) {
  const accepted = input.accepted ?? [];
  const linesByQuotation = input.linesByQuotation ?? {};
  return {
    job: {
      findFirst: jest.fn().mockResolvedValue(input.job ?? ongoingJob()),
    },
    customerQuotation: {
      findMany: jest.fn().mockResolvedValue(accepted),
      findFirst: jest.fn(),
    },
    customerQuotationLine: {
      findMany: jest.fn(async ({ where }: any) => {
        const quotationId = where.quotationId ?? where?.id?.in?.[0];
        if (quotationId && linesByQuotation[quotationId]) {
          return linesByQuotation[quotationId];
        }
        if (where.id?.in) {
          return where.id.in
            .map((lineId: string) =>
              Object.values(linesByQuotation)
                .flat()
                .find((line: any) => line.id === lineId),
            )
            .filter(Boolean);
        }
        return [];
      }),
    },
    customerRateTemplate: {
      findFirst: jest
        .fn()
        .mockResolvedValue(input.template === undefined ? null : input.template),
    },
    masterRateDataset: { findFirst: jest.fn().mockResolvedValue(null) },
    masterRateDatasetRow: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe("Job charge accepted-quotation integrity", () => {
  it("1. exposes two accepted quotations for operator selection", async () => {
    const prisma: any = cataloguePrisma({
      accepted: [acceptedQuotation("q-a"), acceptedQuotation("q-b")],
      linesByQuotation: {
        "q-a": [{ id: "line-a1", code: "A1", label: "A line", unitPriceCents: 1000 }],
        "q-b": [{ id: "line-b1", code: "B1", label: "B line", unitPriceCents: 2000 }],
      },
      template: { id: "tmpl-1", name: "Legacy", rows: [] },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.acceptedQuotations).toHaveLength(2);
    expect(result.acceptedQuotations.map((row) => row.id).sort()).toEqual([
      "q-a",
      "q-b",
    ]);
    expect(result.quotationLines).toHaveLength(2);
  });

  it("2. does not designate either quotation as silently applicable by recency", async () => {
    const prisma: any = cataloguePrisma({
      accepted: [acceptedQuotation("q-a"), acceptedQuotation("q-b")],
      linesByQuotation: {
        "q-a": [{ id: "line-a1", code: "A1", label: "A line", unitPriceCents: 1000 }],
        "q-b": [{ id: "line-b1", code: "B1", label: "B line", unitPriceCents: 2000 }],
      },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.boundQuotation).toBeNull();
    expect(prisma.customerQuotation.findFirst).not.toHaveBeenCalled();
    expect(prisma.customerQuotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: CustomerQuotationStatus.ACCEPTED,
        }),
        orderBy: [{ acceptedAt: "asc" }, { quotationNo: "asc" }],
      }),
    );
    expect(result.acceptedQuotations[0]?.id).toBe("q-a");
    expect(result.acceptedQuotations[1]?.id).toBe("q-b");
  });

  it("3. binds the job to quotation A when the first saved line comes from A", async () => {
    const jobUpdate = jest.fn().mockResolvedValue({});
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue(ongoingJob()),
        update: jobUpdate,
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          jobCharge: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
          invoiceChargeReservation: { findMany: jest.fn().mockResolvedValue([]) },
          customerQuotationLine: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: "line-a1",
                quotationId: "q-a",
                code: "A1",
                label: "A line",
                unitPriceCents: 1000,
                currency: "SGD",
                taxCode: "SR",
                taxRate: 900,
                quotation: acceptedQuotation("q-a"),
              },
            ]),
          },
          customerRateTemplateRow: { findMany: jest.fn().mockResolvedValue([]) },
          job: { update: jobUpdate },
        }),
      ),
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
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
            sourceCustomerQuotationLineId: "line-a1",
            code: "A1",
            label: "A line",
            qty: 1,
            unitPriceCents: 1000,
          },
        ],
      } as any,
      actor,
    );

    expect(jobUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { sourceCustomerQuotationId: "q-a" },
      }),
    );
  });

  it("4. rejects quotation B lines after the job is bound to quotation A", async () => {
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue(
          ongoingJob({ sourceCustomerQuotationId: "q-a" }),
        ),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          jobCharge: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn(),
            createMany: jest.fn(),
          },
          invoiceChargeReservation: { findMany: jest.fn().mockResolvedValue([]) },
          customerQuotationLine: {
            findMany: jest.fn().mockResolvedValue([]),
          },
          customerRateTemplateRow: { findMany: jest.fn().mockResolvedValue([]) },
        }),
      ),
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
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
              sourceCustomerQuotationLineId: "line-b1",
              code: "B1",
              label: "B line",
              qty: 1,
              unitPriceCents: 2000,
            },
          ],
        } as any,
        actor,
      ),
    ).rejects.toThrow("does not belong to the job's bound quotation");
  });

  it("5. rejects mixed A+B quotation line ids atomically on first save", async () => {
    const jobUpdate = jest.fn();
    const createMany = jest.fn();
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue(ongoingJob()),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          jobCharge: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn(),
            createMany,
          },
          invoiceChargeReservation: { findMany: jest.fn().mockResolvedValue([]) },
          customerQuotationLine: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: "line-a1",
                quotationId: "q-a",
                quotation: acceptedQuotation("q-a"),
              },
              {
                id: "line-b1",
                quotationId: "q-b",
                quotation: acceptedQuotation("q-b"),
              },
            ]),
          },
          customerRateTemplateRow: { findMany: jest.fn().mockResolvedValue([]) },
          job: { update: jobUpdate },
        }),
      ),
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
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
              sourceCustomerQuotationLineId: "line-a1",
              code: "A1",
              label: "A line",
              qty: 1,
              unitPriceCents: 1000,
            },
            {
              sourceType: "CUSTOMER_QUOTATION",
              sourceCustomerQuotationLineId: "line-b1",
              code: "B1",
              label: "B line",
              qty: 1,
              unitPriceCents: 2000,
            },
          ],
        } as any,
        actor,
      ),
    ).rejects.toThrow("single accepted quotation");
    expect(jobUpdate).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("6. excludes draft and generated-but-unaccepted quotations", async () => {
    const prisma: any = cataloguePrisma({
      accepted: [],
      template: null,
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.acceptedQuotations).toEqual([]);
    expect(prisma.customerQuotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: CustomerQuotationStatus.ACCEPTED,
        }),
      }),
    );
  });

  it("7. uses frozen quotation line amounts from the accepted quotation", async () => {
    const prisma: any = cataloguePrisma({
      accepted: [acceptedQuotation("q-a")],
      linesByQuotation: {
        "q-a": [
          {
            id: "line-a1",
            code: "A1",
            label: "Frozen line",
            unitPriceCents: 12500,
            qty: 1,
          },
        ],
      },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.quotationLines[0]).toMatchObject({
      unitPriceCents: 12500,
      source: "CUSTOMER_QUOTATION",
    });
  });

  it("does not expose legacy template when accepted quotations exist", async () => {
    const prisma: any = cataloguePrisma({
      accepted: [acceptedQuotation("q-a"), acceptedQuotation("q-b")],
      linesByQuotation: {
        "q-a": [{ id: "line-a1", code: "A1", label: "A line", unitPriceCents: 1000 }],
        "q-b": [{ id: "line-b1", code: "B1", label: "B line", unitPriceCents: 2000 }],
      },
      template: {
        id: "tmpl-1",
        name: "Legacy",
        rows: [{ id: "row-1", code: "R1", label: "Legacy row", rateCents: 9000 }],
      },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.acceptedQuotations).toHaveLength(2);
    expect(result.legacyTemplate).toBeNull();
    expect(prisma.customerRateTemplate.findFirst).not.toHaveBeenCalled();
  });

  it("rejects mixed quotation and legacy template lines atomically", async () => {
    const jobUpdate = jest.fn();
    const createMany = jest.fn();
    const prisma: any = {
      job: {
        findFirst: jest.fn().mockResolvedValue(ongoingJob()),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          jobCharge: {
            findMany: jest.fn().mockResolvedValue([]),
            deleteMany: jest.fn(),
            createMany,
          },
          invoiceChargeReservation: { findMany: jest.fn().mockResolvedValue([]) },
          customerQuotationLine: {
            findMany: jest.fn().mockResolvedValue([
              {
                id: "line-a1",
                quotationId: "q-a",
                quotation: acceptedQuotation("q-a"),
              },
            ]),
          },
          customerRateTemplateRow: { findMany: jest.fn().mockResolvedValue([]) },
          job: { update: jobUpdate },
        }),
      ),
    };
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
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
              sourceCustomerQuotationLineId: "line-a1",
              code: "A1",
              label: "A line",
              qty: 1,
              unitPriceCents: 1000,
            },
            {
              sourceType: "MANUAL",
              sourceRefId: "row-legacy",
              code: "R1",
              label: "Legacy row",
              qty: 1,
              unitPriceCents: 9000,
            },
          ],
        } as any,
        actor,
      ),
    ).rejects.toThrow("legacy customer rate template");
    expect(jobUpdate).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("9. scopes accepted quotations to the job tenant and customer", async () => {
    const prisma: any = cataloguePrisma({ accepted: [] });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(prisma.customerQuotation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          customerCompanyId: "comp1",
        }),
      }),
    );
  });

  it("10. keeps legacy template available but separate from quotation-bound jobs", async () => {
    const prisma: any = cataloguePrisma({
      job: ongoingJob({
        sourceCustomerQuotationId: "q-a",
        sourceCustomerQuotation: acceptedQuotation("q-a"),
      }),
      accepted: [acceptedQuotation("q-a")],
      linesByQuotation: {
        "q-a": [{ id: "line-a1", code: "A1", label: "A line", unitPriceCents: 1000 }],
      },
      template: {
        id: "tmpl-1",
        name: "Legacy",
        rows: [{ id: "row-1", code: "R1", label: "Legacy row", rateCents: 9000 }],
      },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.boundQuotation?.id).toBe("q-a");
    expect(result.acceptedQuotations).toHaveLength(1);
    expect(result.legacyTemplate).toBeNull();
    expect(result.quotationLines.every((line) => line.quotationId === "q-a")).toBe(
      true,
    );
  });

  it("exposes legacy template separately when no accepted quotation exists", async () => {
    const prisma: any = cataloguePrisma({
      accepted: [],
      template: {
        id: "tmpl-1",
        name: "Legacy",
        rows: [{ id: "row-1", code: "R1", label: "Legacy row", rateCents: 9000 }],
      },
    });
    const svc = new TransportJobsService(
      prisma,
      { log: jest.fn() } as any,
      { getClient: jest.fn() } as any,
    );

    const result = await svc.getBillingChargeOptionsForJob("t1", "job1", actor);
    expect(result.quotationSource).toBe("NONE");
    expect(result.legacyTemplate?.lines).toHaveLength(1);
    expect(result.quotationLines).toEqual([]);
  });
});
