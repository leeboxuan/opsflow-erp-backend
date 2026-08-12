import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  CustomerQuotationStatus,
  MasterRateDatasetStatus,
  MasterRateDatasetType,
} from "@prisma/client";
import { CustomerQuotationsService } from "./customer-quotations.service";
import * as quotationParseHelpers from "../quotation-parse.helpers";

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

  it("from-master deep-copies ACTIVE QUOTATION dataset; no parser; snapshot independent", async () => {
    const masterMeta = {
      annex: "A",
      variantType: "CONTAINER",
      additionalRuleText: "Rule X",
      rate20ftCents: 12000,
      rate40ftCents: 18000,
      rawRateText: "see note",
    };
    const masterRows = [
      {
        id: "mr1",
        code: "A1",
        label: "Haulage 20'",
        description: "Door delivery",
        unit: "trip",
        currency: "SGD",
        rateCents: 10000,
        rawRateText: "see note",
        requiresManualAmount: false,
        notes: "Handle with care",
        sortOrder: 0,
        isActive: true,
        metadataJson: masterMeta,
      },
      {
        id: "mr2",
        code: "B1",
        label: "Manual fee",
        description: null,
        unit: null,
        currency: "SGD",
        rateCents: null,
        rawRateText: "TBA",
        requiresManualAmount: true,
        notes: null,
        sortOrder: 1,
        isActive: true,
        metadataJson: { annex: "B", rawRateText: "TBA" },
      },
    ];
    const createMany = jest.fn().mockResolvedValue({ count: 2 });
    const create = jest.fn().mockResolvedValue({
      id: "q-master",
      tenantId: "t1",
      customerCompanyId: "c1",
      quotationNo: "QT-202608-0001",
      status: CustomerQuotationStatus.DRAFT,
      sourceTemplateId: null,
      sourceTemplateNameSnapshot: "Master quotation template v4",
    });
    const findFirstAfter = jest.fn().mockImplementation(async () => {
      const copied = createMany.mock.calls[0][0].data.map((row: any, i: number) => ({
        id: `ql${i + 1}`,
        ...row,
      }));
      return {
        id: "q-master",
        tenantId: "t1",
        customerCompanyId: "c1",
        quotationNo: "QT-202608-0001",
        status: CustomerQuotationStatus.DRAFT,
        currency: "SGD",
        title: "Master quotation template v4",
        sourceTemplateId: null,
        sourceTemplateNameSnapshot: "Master quotation template v4",
        subtotalCents: 10000,
        taxCents: 900,
        totalCents: 10900,
        lines: copied,
      };
    });
    const parseRateSpy = jest.spyOn(
      quotationParseHelpers,
      "parseQuotationRateLinesFromXlsxBuffer",
    );
    const parseMatrixSpy = jest.spyOn(
      quotationParseHelpers,
      "parseQuotationMatrixFromXlsxBuffer",
    );
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ds1",
          versionNo: 4,
          type: MasterRateDatasetType.QUOTATION,
          status: MasterRateDatasetStatus.ACTIVE,
          rows: masterRows,
        }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          quotation_no_counters: {
            upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
          },
          customerQuotation: { create, findFirst: findFirstAfter },
          customerQuotationLine: { createMany },
        }),
      ),
    };
    const { svc, audit } = makeService(prisma);

    const res = await svc.createFromMaster("t1", "c1", {}, "u1");

    expect(parseRateSpy).not.toHaveBeenCalled();
    expect(parseMatrixSpy).not.toHaveBeenCalled();
    expect(createMany).toHaveBeenCalled();
    const rowData = createMany.mock.calls[0][0].data;
    expect(rowData).toHaveLength(2);
    expect(rowData[0].sourceMasterRowId).toBe("mr1");
    expect(rowData[0].sourceTemplateRowId).toBeNull();
    expect(rowData[0].unitPriceCents).toBe(10000);
    expect(rowData[0].qty).toBe(1);
    expect(rowData[0].metadataJson).toEqual(
      expect.objectContaining({
        annex: "A",
        variantType: "CONTAINER",
        additionalRuleText: "Rule X",
        rate20ftCents: 12000,
        rate40ftCents: 18000,
        rawRateText: "see note",
        notes: "Handle with care",
      }),
    );
    expect(rowData[1].sourceMasterRowId).toBe("mr2");
    expect(rowData[1].unitPriceCents).toBe(0);
    expect(rowData[1].requiresManualAmount).toBe(true);

    // Snapshot independence: mutating returned line metadata must not mutate master.
    expect(res.lines[0].metadataJson).not.toBe(masterMeta);
    (res.lines[0].metadataJson as any).annex = "MUTATED";
    expect(masterMeta.annex).toBe("A");

    expect(res.sourceTemplateNameSnapshot).toBe("Master quotation template v4");
    expect(res.sourceTemplateId).toBeNull();
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "CREATE",
      "CustomerQuotation",
      "q-master",
      expect.objectContaining({
        fromMasterDatasetId: "ds1",
        versionNo: 4,
        lineCount: 2,
      }),
      "u1",
    );

    parseRateSpy.mockRestore();
    parseMatrixSpy.mockRestore();
  });

  it("from-master throws when no ACTIVE master QUOTATION template", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      masterRateDataset: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
      $transaction: jest.fn(),
    };
    const { svc } = makeService(prisma);
    await expect(svc.createFromMaster("t1", "c1", {}, "u1")).rejects.toThrow(
      /no base quotation template/i,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
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
      in: [
        CustomerQuotationStatus.DRAFT,
        CustomerQuotationStatus.ISSUED,
        CustomerQuotationStatus.SIGNED,
      ],
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

  function buildAnnexQuotationXlsxBuffer(): Buffer {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const rows: any[] = [];
    rows.push(["Annex A"]);
    rows.push(["A", "SECTION A"]);
    for (let i = 1; i <= 8; i++) {
      rows.push([String(i), `Item A${i}`, `$${i}.00`]);
    }
    rows.push(["B", "SECTION B"]);
    for (let i = 1; i <= 14; i++) {
      rows.push([String(i), `Item B${i}`, `$${i}.00`]);
    }
    rows.push(["Annex B"]);
    rows.push(["C", "SECTION C"]);
    for (let i = 1; i <= 5; i++) {
      rows.push([String(i), `Item C${i}`, `$${i}.00`]);
    }
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, "Annex A");
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }

  function buildEmptyControlledXlsxBuffer(): Buffer {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["code", "label", "rateCents"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
    return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
  }

  it("previewFromRateExcel rejects non-excel", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.previewFromRateExcel("t1", "c1", {
        originalname: "rates.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from("x"),
      } as any),
    ).rejects.toThrow("Quotation import must be Excel (.xlsx/.xls)");
  });

  it("previewFromRateExcel rejects empty parse", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.previewFromRateExcel("t1", "c1", {
        originalname: "empty.xlsx",
        mimetype:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: buildEmptyControlledXlsxBuffer(),
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("previewFromRateExcel parses in-memory xlsx with usable lines", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
    };
    const { svc } = makeService(prisma);
    const preview = await svc.previewFromRateExcel("t1", "c1", {
      originalname: "rates.xlsx",
      mimetype:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buildAnnexQuotationXlsxBuffer(),
    } as any);
    expect(preview.datasetType).toBe("QUOTATION");
    expect(preview.fileName).toBe("rates.xlsx");
    expect(preview.validRows).toBeGreaterThan(0);
    expect(preview.items.length).toBeGreaterThan(0);
    expect(preview.items[0].code).toBeTruthy();
    expect(preview.items[0].label).toBeTruthy();
    expect(preview.items[0].metadataJson).toEqual(
      expect.objectContaining({
        importSource: "RATE_EXCEL",
        sourceFileName: "rates.xlsx",
      }),
    );
  });

  it("createFromRateExcel creates DRAFT without template/master dataset writes", async () => {
    const customerRateTemplateCreate = jest.fn();
    const masterRateDatasetCreate = jest.fn();
    const create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: "q-excel",
        ...data,
        lines: data.lines.create,
      }),
    );
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerRateTemplate: { create: customerRateTemplateCreate },
      masterRateDataset: { create: masterRateDatasetCreate },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          quotation_no_counters: {
            upsert: jest.fn().mockResolvedValue({ nextSeq: 3 }),
          },
          customerQuotation: { create },
        }),
      ),
    };
    const { svc } = makeService(prisma);
    const res = await svc.createFromRateExcel(
      "t1",
      "c1",
      {
        originalname: "customer-rates.xlsx",
        mimetype:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: buildAnnexQuotationXlsxBuffer(),
      } as any,
      {},
      "u1",
    );
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(customerRateTemplateCreate).not.toHaveBeenCalled();
    expect(masterRateDatasetCreate).not.toHaveBeenCalled();
    expect(res.status).toBe(CustomerQuotationStatus.DRAFT);
    expect(res.sourceTemplateId).toBeNull();
    expect(res.sourceTemplateNameSnapshot).toBe("Excel: customer-rates.xlsx");
    expect(res.title).toBe("customer-rates");
    expect(res.lines.length).toBeGreaterThan(0);
    expect(res.lines[0].sourceTemplateRowId).toBeNull();
    expect(res.lines[0].sourceMasterRowId).toBeNull();
    expect(res.lines[0].metadataJson).toEqual(
      expect.objectContaining({ importSource: "RATE_EXCEL" }),
    );
  });

  it("createFromRateExcel is transactional (line failure leaves no quotation)", async () => {
    const create = jest.fn().mockRejectedValue(new Error("line create failed"));
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerRateTemplate: { create: jest.fn() },
      masterRateDataset: { create: jest.fn() },
      customerQuotation: { findFirst: jest.fn().mockResolvedValue(null) },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          quotation_no_counters: {
            upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
          },
          customerQuotation: { create },
        }),
      ),
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.createFromRateExcel(
        "t1",
        "c1",
        {
          originalname: "rates.xlsx",
          buffer: buildAnnexQuotationXlsxBuffer(),
        } as any,
        { title: "T" },
        "u1",
      ),
    ).rejects.toThrow("line create failed");
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.customerQuotation.findFirst).not.toHaveBeenCalled();
  });

  it("createFromRateExcel wrong customer → NotFound; get after create also cross-customer NotFound", async () => {
    const prismaMissing: any = {
      customer_companies: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const { svc: svcMissing } = makeService(prismaMissing);
    await expect(
      svcMissing.createFromRateExcel(
        "t1",
        "c-missing",
        {
          originalname: "rates.xlsx",
          buffer: buildAnnexQuotationXlsxBuffer(),
        } as any,
        {},
        "u1",
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    const created = draftQuotation({
      id: "q-excel",
      customerCompanyId: "c1",
      lines: [{ id: "l1", code: "A", label: "Item" }],
    });
    const prisma: any = {
      customer_companies: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "c1", name: "Acme" })
          .mockResolvedValueOnce({ id: "c2", name: "Beta" }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          quotation_no_counters: {
            upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
          },
          customerQuotation: {
            create: jest.fn().mockResolvedValue(created),
          },
        }),
      ),
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(created),
      },
    };
    const { svc } = makeService(prisma);
    await svc.createFromRateExcel(
      "t1",
      "c1",
      {
        originalname: "rates.xlsx",
        buffer: buildAnnexQuotationXlsxBuffer(),
      } as any,
      { title: "From Excel" },
      "u1",
    );
    await expect(svc.getById("t1", "c2", "q-excel")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("createFromRateExcel rejects empty parse", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      $transaction: jest.fn(),
    };
    const { svc } = makeService(prisma);
    await expect(
      svc.createFromRateExcel(
        "t1",
        "c1",
        {
          originalname: "empty.xlsx",
          buffer: buildEmptyControlledXlsxBuffer(),
        } as any,
        {},
        "u1",
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("createFromRateExcel single-flight rejects concurrent create for same customer", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = jest.fn().mockImplementation(async ({ data }) => {
      await gate;
      return { id: "q-excel", ...data, lines: data.lines.create };
    });
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          quotation_no_counters: {
            upsert: jest.fn().mockResolvedValue({ nextSeq: 1 }),
          },
          customerQuotation: { create },
        }),
      ),
    };
    const { svc } = makeService(prisma);
    const file = {
      originalname: "rates.xlsx",
      buffer: buildAnnexQuotationXlsxBuffer(),
    } as any;
    const first = svc.createFromRateExcel("t1", "c1", file, {}, "u1");
    await expect(
      svc.createFromRateExcel("t1", "c1", file, {}, "u1"),
    ).rejects.toThrow(/already in progress/i);
    release();
    await first;
  });

  it("createFromRateExcel preserves annex/section metadata on lines", async () => {
    const create = jest.fn().mockImplementation(({ data }) =>
      Promise.resolve({
        id: "q-excel",
        ...data,
        lines: data.lines.create,
      }),
    );
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          quotation_no_counters: {
            upsert: jest.fn().mockResolvedValue({ nextSeq: 4 }),
          },
          customerQuotation: { create },
        }),
      ),
    };
    const { svc } = makeService(prisma);
    const res = await svc.createFromRateExcel(
      "t1",
      "c1",
      {
        originalname: "annex.xlsx",
        buffer: buildAnnexQuotationXlsxBuffer(),
      } as any,
      {},
      "u1",
    );
    expect(res.lines.length).toBeGreaterThan(1);
    const withMeta = res.lines.find(
      (l: any) => l.metadataJson && (l.metadataJson as any).annex,
    );
    expect(withMeta).toBeTruthy();
    expect(withMeta.metadataJson).toEqual(
      expect.objectContaining({
        importSource: "RATE_EXCEL",
        annex: expect.anything(),
      }),
    );
    const codes = res.lines.map((l: any) => l.code);
    expect(new Set(codes).size).toBeGreaterThan(1);
  });

  it("issue blocked when requiresManualAmount and unitPriceCents 0", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Acme" }),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue(
          draftQuotation({
            lines: [
              {
                ...sampleLine,
                unitPriceCents: 0,
                amountCents: 0,
                taxCents: 0,
                requiresManualAmount: true,
              },
            ],
          }),
        ),
        updateMany: jest.fn(),
      },
    };
    const { svc } = makeService(prisma);
    await expect(svc.issue("t1", "c1", "q1", "u1")).rejects.toThrow(
      /require a manual unit price/i,
    );
    expect(prisma.customerQuotation.updateMany).not.toHaveBeenCalled();
  });
});
