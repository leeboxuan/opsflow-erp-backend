import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CustomerQuotationStatus } from "@prisma/client";
import { CustomerQuotationsService } from "./customer-quotations.service";

jest.mock("./customer-quotation-pdf", () => ({
  createCustomerQuotationPdfBuffer: jest
    .fn()
    .mockResolvedValue(Buffer.from("%PDF-mock")),
}));

describe("CustomerQuotationsService", () => {
  function makeService(prisma: any, extras: any = {}) {
    const audit = extras.audit ?? { log: jest.fn().mockResolvedValue(undefined) };
    const supabaseService =
      extras.supabaseService ??
      ({
        getClient: () => ({
          storage: {
            from: () => ({
              upload: jest.fn().mockResolvedValue({ error: null }),
              createSignedUrl: jest.fn().mockResolvedValue({
                data: { signedUrl: "https://signed/qt.pdf" },
                error: null,
              }),
            }),
          },
        }),
      } as any);
    return {
      svc: new CustomerQuotationsService(prisma, audit, supabaseService),
      audit,
    };
  }

  function draftQuotation(overrides: Record<string, unknown> = {}) {
    return {
      id: "q1",
      tenantId: "t1",
      customerCompanyId: "c1",
      quotationNo: "QT-202608-0001",
      status: CustomerQuotationStatus.DRAFT,
      currency: "SGD",
      title: null,
      notes: null,
      validFrom: null,
      validUntil: null,
      issueDate: null,
      sourceTemplateId: null,
      sourceTemplateNameSnapshot: null,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      customerNameSnapshot: "Acme",
      lockedAt: null,
      pdfKey: null,
      lines: [],
      ...overrides,
    };
  }

  const sampleLine = {
    code: "A",
    label: "Haul",
    description: null,
    qty: 1,
    unitPriceCents: 10000,
    amountCents: 10000,
    taxRate: 900,
    taxCents: 900,
  };

  it("rejects missing customer company (cross-tenant isolation)", async () => {
    const prisma: any = {
      customer_companies: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const { svc } = makeService(prisma);
    await expect(svc.list("t1", "c-missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("cross-customer getById → NotFound (no existence leak)", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: {
        findFirst: jest
          .fn()
          .mockResolvedValue(draftQuotation({ customerCompanyId: "c2" })),
      },
    };
    const { svc } = makeService(prisma);
    await expect(svc.getById("t1", "c1", "q1")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("numbering uses quotation_no_counters upsert", async () => {
    const upsert = jest.fn().mockResolvedValue({ nextSeq: 7 });
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          quotation_no_counters: { upsert },
          customerQuotation: {
            create: jest.fn().mockImplementation(({ data }) =>
              Promise.resolve({
                ...draftQuotation({ quotationNo: data.quotationNo }),
                lines: [],
              }),
            ),
          },
        }),
      ),
    };
    const { svc } = makeService(prisma);
    const at = new Date(Date.UTC(2026, 7, 12));
    const res = await svc.createBlank("t1", "c1", {}, "u1");
    const no = await svc.allocateQuotationNo(
      "t1",
      {
        quotation_no_counters: { upsert },
      } as any,
      at,
    );
    expect(no).toBe("QT-202608-0007");
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId_yyyymm: { tenantId: "t1", yyyymm: "202608" } },
        create: expect.objectContaining({ nextSeq: 1 }),
        update: { nextSeq: { increment: 1 } },
      }),
    );
    expect(res.quotationNo).toBeTruthy();
  });

  it("from-template snapshots lines; source ids audit-only", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerRateTemplate: {
        findFirst: jest.fn().mockResolvedValue({
          id: "tpl1",
          customerCompanyId: "c1",
          name: "Acme rates",
          currency: "SGD",
          notes: null,
          rows: [
            {
              id: "tr1",
              code: "A",
              label: "Haulage",
              description: null,
              unit: "trip",
              rateCents: 10000,
              currency: "SGD",
              requiresManualAmount: false,
              sortOrder: 0,
              sourceMasterRowId: "mr9",
              metadataJson: null,
              isActive: true,
            },
          ],
        }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          quotation_no_counters: {
            upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
          },
          customerQuotation: {
            create: jest.fn().mockImplementation(({ data }) =>
              Promise.resolve({
                id: "q-new",
                ...data,
                lines: data.lines.create,
              }),
            ),
          },
        }),
      ),
    };
    const { svc } = makeService(prisma);
    const res = await svc.createFromTemplate(
      "t1",
      "c1",
      { templateId: "tpl1" },
      "u1",
    );
    expect(res.sourceTemplateId).toBe("tpl1");
    expect(res.sourceTemplateNameSnapshot).toBe("Acme rates");
    expect(res.lines[0].sourceTemplateRowId).toBe("tr1");
    expect(res.lines[0].sourceMasterRowId).toBe("mr9");
    expect(res.lines[0].unitPriceCents).toBe(10000);
    expect(res.subtotalCents).toBe(10000);
    expect(res.taxCents).toBe(900);
    expect(res.totalCents).toBe(10900);
  });

  it("totals include GST (basis points) via money helpers", () => {
    const { svc } = makeService({});
    const totals = svc.computeLineTotals([
      {
        code: "A",
        label: "Line",
        qty: 2,
        unitPriceCents: 1000,
        taxRate: 900,
      },
    ]);
    expect(totals.subtotalCents).toBe(2000);
    expect(totals.taxCents).toBe(180);
    expect(totals.totalCents).toBe(2180);
  });

  it("computeLineTotals forces quotation currency on lines", () => {
    const { svc } = makeService({});
    const totals = svc.computeLineTotals(
      [
        {
          code: "A",
          label: "Line",
          qty: 0.1,
          unitPriceCents: 100,
          currency: "USD",
          taxRate: 900,
        },
      ],
      "SGD",
    );
    expect(totals.subtotalCents).toBe(10);
    expect(totals.taxCents).toBe(1);
    expect(totals.normalized[0].currency).toBe("SGD");
  });

  it("computeLineTotals rejects qty with more than 3 decimals", () => {
    const { svc } = makeService({});
    expect(() =>
      svc.computeLineTotals([
        {
          code: "A",
          label: "Line",
          qty: 0.1234,
          unitPriceCents: 100,
          taxRate: 900,
        },
      ]),
    ).toThrow(BadRequestException);
  });

  it("customer change without confirm fails when populated", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(
          draftQuotation({
            sourceTemplateId: "tpl1",
            lines: [{ id: "l1" }],
          }),
        ),
      },
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.update("t1", "c1", "q1", { customerCompanyId: "c2" }, "u1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("customer change with confirm clears lines+template atomically", async () => {
    const deleteMany = jest.fn().mockResolvedValue({ count: 1 });
    const update = jest.fn().mockResolvedValue(
      draftQuotation({
        customerCompanyId: "c2",
        sourceTemplateId: null,
        sourceTemplateNameSnapshot: null,
        lines: [],
        subtotalCents: 0,
        taxCents: 0,
        totalCents: 0,
      }),
    );
    const prisma: any = {
      customer_companies: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "c1", name: "Acme" })
          .mockResolvedValueOnce({ id: "c2", name: "Beta" })
          .mockResolvedValue({ id: "c2", name: "Beta" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(
          draftQuotation({
            sourceTemplateId: "tpl1",
            sourceTemplateNameSnapshot: "Tpl",
            lines: [{ id: "l1", amountCents: 100 }],
            subtotalCents: 100,
          }),
        ),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          customerQuotationLine: { deleteMany },
          customer_companies: {
            findFirst: jest.fn().mockResolvedValue({ name: "Beta" }),
          },
          customerQuotation: { update },
        }),
      ),
    };
    const { svc } = makeService(prisma);
    const res = await svc.update(
      "t1",
      "c1",
      "q1",
      { customerCompanyId: "c2", confirmCustomerChange: true },
      "u1",
    );
    expect(deleteMany).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerCompanyId: "c2",
          sourceTemplateId: null,
          subtotalCents: 0,
        }),
      }),
    );
    expect(res.customerCompanyId).toBe("c2");
    expect(res.lines).toEqual([]);
  });

  it("issue rejects empty lines", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(draftQuotation({ lines: [] })),
        updateMany: jest.fn(),
      },
    };
    const { svc } = makeService(prisma);
    await expect(svc.issue("t1", "c1", "q1", "u1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.customerQuotation.updateMany).not.toHaveBeenCalled();
  });

  it("issue locks via updateMany DRAFT→ISSUED and sets PDF", async () => {
    const upload = jest.fn().mockResolvedValue({ error: null });
    const issued = draftQuotation({
      status: CustomerQuotationStatus.ISSUED,
      lockedAt: new Date(),
      issuedAt: new Date(),
      issueDate: new Date(),
      lines: [sampleLine],
      subtotalCents: 10000,
      taxCents: 900,
      totalCents: 10900,
    });
    const withPdf = {
      ...issued,
      pdfKey: "t1/companies/c1/customer-quotations/q1/QT-202608-0001.pdf",
      pdfGeneratedAt: new Date(),
    };
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(
        draftQuotation({
          lines: [sampleLine],
          subtotalCents: 10000,
          taxCents: 900,
          totalCents: 10900,
        }),
      )
      .mockResolvedValueOnce(issued);
    const update = jest.fn().mockResolvedValue(withPdf);
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: { findFirst, updateMany, update },
    };
    const { svc } = makeService(prisma, {
      supabaseService: {
        getClient: () => ({
          storage: { from: () => ({ upload }) },
        }),
      },
    });
    const res = await svc.issue("t1", "c1", "q1", "u1");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: CustomerQuotationStatus.DRAFT,
        }),
        data: expect.objectContaining({
          status: CustomerQuotationStatus.ISSUED,
        }),
      }),
    );
    expect(res.status).toBe(CustomerQuotationStatus.ISSUED);
    expect(upload).toHaveBeenCalled();
    expect(res.pdfKey).toContain("customer-quotations");
  });

  it("issue PDF upload failure rolls back with updateMany status ISSUED only", async () => {
    const upload = jest.fn().mockResolvedValue({ error: { message: "fail" } });
    const issued = draftQuotation({
      status: CustomerQuotationStatus.ISSUED,
      lockedAt: new Date(),
      issuedAt: new Date(),
      issueDate: new Date(),
      lines: [sampleLine],
      subtotalCents: 10000,
      taxCents: 900,
      totalCents: 10900,
    });
    const updateMany = jest
      .fn()
      .mockResolvedValueOnce({ count: 1 }) // lock DRAFT→ISSUED
      .mockResolvedValueOnce({ count: 1 }); // rollback ISSUED→DRAFT
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(
        draftQuotation({
          lines: [sampleLine],
          subtotalCents: 10000,
          taxCents: 900,
          totalCents: 10900,
        }),
      )
      .mockResolvedValueOnce(issued);
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: { findFirst, updateMany, update: jest.fn() },
    };
    const { svc } = makeService(prisma, {
      supabaseService: {
        getClient: () => ({
          storage: { from: () => ({ upload }) },
        }),
      },
    });
    await expect(svc.issue("t1", "c1", "q1", "u1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "q1",
          tenantId: "t1",
          status: CustomerQuotationStatus.ISSUED,
        }),
        data: expect.objectContaining({
          status: CustomerQuotationStatus.DRAFT,
          issueDate: null,
          issuedAt: null,
          pdfKey: null,
        }),
      }),
    );
    expect(prisma.customerQuotation.update).not.toHaveBeenCalled();
  });

  it("accept requires acceptanceMethod", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(
          draftQuotation({
            status: CustomerQuotationStatus.ISSUED,
            validUntil: null,
            lines: [],
          }),
        ),
      },
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.accept("t1", "c1", "q1", {} as any, "u1"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accept without evidence note throws", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(
          draftQuotation({
            status: CustomerQuotationStatus.ISSUED,
            validUntil: null,
            lines: [],
          }),
        ),
        updateMany: jest.fn(),
      },
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.accept(
        "t1",
        "c1",
        "q1",
        { acceptanceMethod: "EMAIL", acceptanceEvidenceNote: "   " },
        "u1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customerQuotation.updateMany).not.toHaveBeenCalled();
  });

  it("expired ISSUED cannot accept (materializes then rejects)", async () => {
    const past = new Date(Date.UTC(2020, 0, 1));
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(
            draftQuotation({
              status: CustomerQuotationStatus.ISSUED,
              validUntil: past,
              lines: [],
            }),
          )
          .mockResolvedValueOnce(
            draftQuotation({
              status: CustomerQuotationStatus.EXPIRED,
              validUntil: past,
              expiredAt: new Date(),
              lines: [],
            }),
          ),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.accept(
        "t1",
        "c1",
        "q1",
        {
          acceptanceMethod: "EMAIL",
          acceptanceEvidenceNote: "Customer emailed acceptance",
        },
        "u1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.customerQuotation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: CustomerQuotationStatus.ISSUED,
        }),
        data: expect.objectContaining({
          status: CustomerQuotationStatus.EXPIRED,
        }),
      }),
    );
  });

  it("void from DRAFT succeeds via updateMany", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(draftQuotation())
          .mockResolvedValueOnce(
            draftQuotation({
              status: CustomerQuotationStatus.VOID,
              voidedAt: new Date(),
            }),
          ),
        updateMany,
      },
    };
    const { svc } = makeService(prisma);
    const res = await svc.void("t1", "c1", "q1", "u1");
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: {
            in: [
              CustomerQuotationStatus.DRAFT,
              CustomerQuotationStatus.ISSUED,
            ],
          },
        }),
        data: expect.objectContaining({
          status: CustomerQuotationStatus.VOID,
        }),
      }),
    );
    expect(res.status).toBe(CustomerQuotationStatus.VOID);
  });

  it("void from ISSUED succeeds (updateMany count 1)", async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(
            draftQuotation({
              status: CustomerQuotationStatus.ISSUED,
              validUntil: null,
              lockedAt: new Date(),
              lines: [sampleLine],
            }),
          )
          .mockResolvedValueOnce(
            draftQuotation({
              status: CustomerQuotationStatus.VOID,
              voidedAt: new Date(),
              lines: [sampleLine],
            }),
          ),
        updateMany,
      },
    };
    const { svc } = makeService(prisma);
    const res = await svc.void("t1", "c1", "q1", "u1");
    expect(updateMany).toHaveBeenCalled();
    expect(updateMany.mock.calls[0][0].where.status).toEqual({
      in: [CustomerQuotationStatus.DRAFT, CustomerQuotationStatus.ISSUED],
    });
    expect(res.status).toBe(CustomerQuotationStatus.VOID);
  });

  it("DRAFT does not auto-expire regardless of validUntil", async () => {
    const past = new Date(Date.UTC(2020, 0, 1));
    const q = draftQuotation({ validUntil: past });
    const prisma: any = {
      customerQuotation: { updateMany: jest.fn() },
    };
    const { svc } = makeService(prisma);
    const res = await svc.materializeExpiry(q as any);
    expect(res.status).toBe(CustomerQuotationStatus.DRAFT);
    expect(prisma.customerQuotation.updateMany).not.toHaveBeenCalled();
  });

  it("ACCEPTED never auto-expires (status gate)", async () => {
    const past = new Date(Date.UTC(2020, 0, 1));
    const q = draftQuotation({
      status: CustomerQuotationStatus.ACCEPTED,
      validUntil: past,
    });
    const prisma: any = {
      customerQuotation: { updateMany: jest.fn() },
    };
    const { svc } = makeService(prisma);
    const res = await svc.materializeExpiry(q as any);
    expect(res.status).toBe(CustomerQuotationStatus.ACCEPTED);
    expect(prisma.customerQuotation.updateMany).not.toHaveBeenCalled();
  });

  it("materializeExpiry does not expire when updateMany count 0 (already ACCEPTED)", async () => {
    const past = new Date(Date.UTC(2020, 0, 1));
    const q = draftQuotation({
      status: CustomerQuotationStatus.ISSUED,
      validUntil: past,
      lines: [],
    });
    const accepted = draftQuotation({
      status: CustomerQuotationStatus.ACCEPTED,
      validUntil: past,
      lines: [],
    });
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const findFirst = jest.fn().mockResolvedValue(accepted);
    const prisma: any = {
      customerQuotation: { updateMany, findFirst },
    };
    const { svc } = makeService(prisma);
    const res = await svc.materializeExpiry(q as any);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: CustomerQuotationStatus.ISSUED,
        }),
        data: expect.objectContaining({
          status: CustomerQuotationStatus.EXPIRED,
        }),
      }),
    );
    expect(findFirst).toHaveBeenCalled();
    expect(res.status).toBe(CustomerQuotationStatus.ACCEPTED);
  });
});
