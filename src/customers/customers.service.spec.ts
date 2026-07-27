import { CustomersService } from "./customers.service";
import { QuotationVersionStatus } from "@prisma/client";

describe("CustomersService quotation upload behavior", () => {
  it("uploadCompanyQuotation is record-only and does not parse/sync master tables", async () => {
    const quotationUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const quotationCreate = jest.fn().mockResolvedValue({
      id: "q1",
      storageKey: "t1/companies/c1/quotations/123.pdf",
      originalName: "signed-quotation.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      effectiveDate: null,
      status: QuotationVersionStatus.ACTIVE,
      createdAt: new Date(),
      parsedSummaryJson: { note: "Signed quotation uploaded for record keeping only (no parsing)." },
    });
    const quotationRateLineCreateMany = jest.fn();
    const customerRateMasterLineCreateMany = jest.fn();
    const customerRateMasterLineUpdateMany = jest.fn();

    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      customerCompanyQuotation: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      customerQuotationRateLine: {
        createMany: quotationRateLineCreateMany,
      },
      customerRateMasterLine: {
        createMany: customerRateMasterLineCreateMany,
        updateMany: customerRateMasterLineUpdateMany,
      },
      $transaction: jest.fn(async (fn: any) =>
        fn({
          customerCompanyQuotation: {
            updateMany: quotationUpdateMany,
            create: quotationCreate,
          },
          customerQuotationRateLine: {
            createMany: quotationRateLineCreateMany,
          },
          customerRateMasterLine: {
            createMany: customerRateMasterLineCreateMany,
            updateMany: customerRateMasterLineUpdateMany,
          },
        }),
      ),
    };

    const storageUpload = jest.fn().mockResolvedValue({ error: null });
    const storageSign = jest
      .fn()
      .mockResolvedValue({ data: { signedUrl: "https://signed-url" }, error: null });
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: storageUpload,
            createSignedUrl: storageSign,
          }),
        },
      }),
    };
    const configService: any = {
      get: jest.fn((k: string) => {
        if (k === "SUPABASE_PROJECT_URL" || k === "SUPABASE_URL") return "https://supabase.example";
        if (k === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-key";
        return null;
      }),
    };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new CustomersService(
      prisma,
      supabaseService,
      configService,
      audit,
    );

    const res = await svc.uploadCompanyQuotation(
      "t1",
      "c1",
      {
        originalname: "signed-quotation.pdf",
        mimetype: "application/pdf",
        buffer: Buffer.from("x"),
        size: 10,
      } as any,
      "u1",
      null,
    );

    expect(res.id).toBe("q1");
    expect(quotationUpdateMany).toHaveBeenCalled();
    expect(quotationCreate).toHaveBeenCalled();
    expect(quotationRateLineCreateMany).not.toHaveBeenCalled();
    expect(customerRateMasterLineCreateMany).not.toHaveBeenCalled();
    expect(customerRateMasterLineUpdateMany).not.toHaveBeenCalled();
    expect(storageUpload).toHaveBeenCalled();
  });

  it("uploadCompanyQuotation rejects non-PDF signed quotation files", async () => {
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
    };
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: jest.fn(),
            createSignedUrl: jest.fn(),
          }),
        },
      }),
    };
    const configService: any = {
      get: jest.fn((k: string) => {
        if (k === "SUPABASE_PROJECT_URL" || k === "SUPABASE_URL") return "https://supabase.example";
        if (k === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-key";
        return null;
      }),
    };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new CustomersService(prisma, supabaseService, configService, audit);

    await expect(
      svc.uploadCompanyQuotation(
        "t1",
        "c1",
        {
          originalname: "signed-quotation.docx",
          mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: Buffer.from("x"),
          size: 10,
        } as any,
        "u1",
        null,
      ),
    ).rejects.toThrow("Signed quotation must be a PDF file");
  });
});

describe("CustomersService customer-company documents listing", () => {
  function makeService(overrides?: Partial<any>) {
    const from = jest.fn().mockImplementation((bucket: string) => ({
      upload: jest.fn().mockResolvedValue({ error: null }),
      remove: jest.fn().mockResolvedValue({ error: null }),
      createSignedUrl: jest
        .fn()
        .mockResolvedValue({ data: { signedUrl: `https://signed/${bucket}` }, error: null }),
    }));
    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      customerCompanyDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn(),
      },
      $transaction: jest.fn(async (ops: any) => {
        if (Array.isArray(ops)) return Promise.all(ops);
        return ops(prisma);
      }),
      ...overrides,
    };
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: { from },
      }),
    };
    const configService: any = {
      get: jest.fn((k: string) => {
        if (k === "SUPABASE_PROJECT_URL" || k === "SUPABASE_URL")
          return "https://supabase.example";
        if (k === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-key";
        return null;
      }),
    };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    return {
      service: new CustomersService(prisma, supabaseService, configService, audit),
      prisma,
      from,
    };
  }

  it("listCustomerCompanyDocuments returns generic and invoice documents", async () => {
    const now = new Date("2026-05-08T00:00:00.000Z");
    const { service } = makeService({
      customerCompanyDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "doc-generic",
            tenantId: "t1",
            customerCompanyId: "c1",
            type: "CUSTOMER_DOCUMENT",
            fileName: "quotation.pdf",
            fileUrl: "t1/companies/c1/documents/quotation.pdf",
            storageKey: "t1/companies/c1/documents/quotation.pdf",
            mimeType: "application/pdf",
            fileSizeBytes: 12,
            uploadedByUserId: "u1",
            uploadedAt: now,
            status: "ACTIVE",
            generatedByUserId: null,
            generatedAt: null,
            sourceJobId: null,
            sourceInvoiceId: null,
            uploadedBy: { name: "Ops" },
            generatedBy: null,
          },
          {
            id: "doc-invoice",
            tenantId: "t1",
            customerCompanyId: "c1",
            type: "INVOICE",
            fileName: "WF-2026-04-0002-IMP-INVOICE.pdf",
            fileUrl: "t1/invoices/inv1/WF-2026-04-0002-IMP-INVOICE.pdf",
            storageKey: "t1/invoices/inv1/WF-2026-04-0002-IMP-INVOICE.pdf",
            mimeType: "application/pdf",
            fileSizeBytes: 34,
            uploadedByUserId: "u2",
            uploadedAt: now,
            status: "ACTIVE",
            generatedByUserId: "u2",
            generatedAt: now,
            sourceJobId: "job1",
            sourceInvoiceId: "inv1",
            uploadedBy: { name: "Finance" },
            generatedBy: { name: "Finance", email: "finance@wf.test" },
          },
        ]),
        count: jest.fn().mockResolvedValue(2),
      },
    });

    const result = await service.listCustomerCompanyDocuments("t1", "c1", {} as any);

    expect(result.data).toHaveLength(2);
    expect(result.data.map((d) => d.type)).toEqual(
      expect.arrayContaining(["CUSTOMER_DOCUMENT", "INVOICE"]),
    );
    expect(result.data.find((d) => d.type === "INVOICE")).toMatchObject({
      sourceInvoiceId: "inv1",
      sourceJobId: "job1",
      generatedByUserId: "u2",
      generatedAt: now,
      mimeType: "application/pdf",
    });
  });

  it("uses invoice-documents bucket for invoice docs signed URL", async () => {
    const { service, from } = makeService({
      customerCompanyDocument: {
        findFirst: jest.fn().mockResolvedValue({
          type: "INVOICE",
          sourceInvoiceId: "inv1",
          storageKey: "t1/invoices/inv1/a.pdf",
          fileUrl: "t1/invoices/inv1/a.pdf",
        }),
      },
    });

    await service.getCustomerCompanyDocumentDownloadUrl("t1", "c1", "doc-invoice");
    expect(from).toHaveBeenCalledWith("invoice-documents");
  });

  it("uses job-documents bucket for generic customer docs signed URL", async () => {
    const { service, from } = makeService({
      customerCompanyDocument: {
        findFirst: jest.fn().mockResolvedValue({
          type: "CUSTOMER_DOCUMENT",
          sourceInvoiceId: null,
          storageKey: "t1/companies/c1/documents/a.pdf",
          fileUrl: "t1/companies/c1/documents/a.pdf",
        }),
      },
    });

    await service.getCustomerCompanyDocumentDownloadUrl("t1", "c1", "doc-generic");
    expect(from).toHaveBeenCalledWith("job-documents");
  });

  it("listCustomerCompanyDocuments excludes deleted docs and enforces tenant scope", async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const findCompany = jest.fn().mockResolvedValue({ id: "c1" });
    const { service, prisma } = makeService({
      customer_companies: { findFirst: findCompany },
      customerCompanyDocument: {
        findMany,
        count: jest.fn().mockResolvedValue(0),
      },
    });

    await service.listCustomerCompanyDocuments("t1", "c1", {} as any);

    expect(findCompany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "c1", tenantId: "t1" } }),
    );
    expect(prisma.customerCompanyDocument.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: "t1",
          customerCompanyId: "c1",
          status: "ACTIVE",
        }),
      }),
    );
  });
});
