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
      tenantModuleEntitlement: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { module: "TRANSPORT" },
            { module: "WAREHOUSING" },
            { module: "FINANCE" },
          ]),
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

describe("CustomersService createCompany quotation base seed", () => {
  const companyRow = {
    id: "c-new",
    name: "Acme",
    email: null,
    phone: null,
    addressLine1: null,
    addressLine2: null,
    postalCode: null,
    country: "SG",
    billingSameAsAddress: false,
    billingAddressLine1: null,
    billingAddressLine2: null,
    billingPostalCode: null,
    billingCountry: "SG",
    picName: null,
    picMobile: null,
    picEmail: null,
    uen: null,
    notes: null,
    isActive: true,
    commercialStatus: "PROSPECT",
    _count: { contacts: 0, users: 0 },
  };

  const seededTemplate = {
    id: "tpl-seed",
    name: "Acme — Default rate template",
    sourceMasterDatasetId: "ds1",
    sourceMasterDatasetVersionNo: 4,
    rows: [
      { id: "tr1", code: "TRK-01", sourceMasterRowId: "mr1" },
      { id: "tr2", code: "TRK-02", sourceMasterRowId: "mr2" },
    ],
  };

  function infra() {
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({ storage: { from: jest.fn() } }),
    };
    const configService: any = {
      get: jest.fn((k: string) => {
        if (k === "SUPABASE_PROJECT_URL" || k === "SUPABASE_URL")
          return "https://supabase.example";
        if (k === "SUPABASE_SERVICE_ROLE_KEY") return "service-role-key";
        return null;
      }),
    };
    return { supabaseService, configService };
  }

  function makeNewCompanyService(opts: {
    seedImpl: (...args: any[]) => Promise<any>;
    racedExisting?: { id: string } | null;
  }) {
    const committed: { company: boolean } = { company: false };
    const txCreate = jest.fn().mockImplementation(async () => {
      committed.company = true;
      return companyRow;
    });
    const tx = {
      customer_companies: {
        findUnique: jest.fn().mockResolvedValue(opts.racedExisting ?? null),
        create: txCreate,
        update: jest.fn().mockResolvedValue({ ...companyRow, id: "c-raced" }),
      },
    };
    const prisma: any = {
      customer_companies: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn(),
      },
      $transaction: jest.fn(async (fn: any) => {
        try {
          return await fn(tx);
        } catch (err) {
          committed.company = false;
          throw err;
        }
      }),
    };
    const seedFromCurrentQuotationBase = jest.fn(opts.seedImpl);
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const realtime = {
      publish: jest.fn(),
      publishDispatchAndDashboard: jest.fn(),
    };
    const { supabaseService, configService } = infra();
    const svc = new CustomersService(
      prisma,
      supabaseService,
      configService,
      audit as any,
      realtime as any,
      { seedFromCurrentQuotationBase } as any,
    );
    return {
      svc,
      prisma,
      tx,
      txCreate,
      seedFromCurrentQuotationBase,
      audit,
      realtime,
      committed,
    };
  }

  it("deep-copies the current quotation base template for a new customer in one transaction", async () => {
    const { svc, prisma, seedFromCurrentQuotationBase, audit, realtime, tx } =
      makeNewCompanyService({
        seedImpl: async () => seededTemplate,
      });

    const res = await svc.createCompany("t1", { name: "Acme" }, "u1");

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.customer_companies.create).toHaveBeenCalled();
    expect(seedFromCurrentQuotationBase).toHaveBeenCalledWith(
      "t1",
      "c-new",
      "u1",
      "Acme",
      { client: tx },
    );
    expect(res.seededCustomerRateTemplate).toEqual({
      id: "tpl-seed",
      name: "Acme — Default rate template",
      rowCount: 2,
      sourceMasterDatasetVersionNo: 4,
      sourceMasterDatasetId: "ds1",
    });
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "CREATE",
      "CustomerRateTemplate",
      "tpl-seed",
      expect.objectContaining({ seededOnCustomerCreate: true, rowCount: 2 }),
      "u1",
    );
    expect(realtime.publish).toHaveBeenCalled();
  });

  it("skips seed when no quotation base template exists", async () => {
    const { svc, seedFromCurrentQuotationBase, audit } = makeNewCompanyService({
      seedImpl: async () => null,
    });
    const res = await svc.createCompany("t1", { name: "Acme" }, "u1");
    expect(seedFromCurrentQuotationBase).toHaveBeenCalled();
    expect(res.id).toBe("c-new");
    expect(res.seededCustomerRateTemplate).toBeNull();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("rolls back the new customer when rate-template row copy fails", async () => {
    const {
      svc,
      prisma,
      seedFromCurrentQuotationBase,
      audit,
      realtime,
      committed,
    } = makeNewCompanyService({
      seedImpl: async () => {
        throw new Error("row copy failed");
      },
    });

    await expect(svc.createCompany("t1", { name: "Acme" }, "u1")).rejects.toThrow(
      "row copy failed",
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(seedFromCurrentQuotationBase).toHaveBeenCalled();
    expect(committed.company).toBe(false);
    expect(prisma.customer_companies.upsert).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(realtime.publish).not.toHaveBeenCalled();
  });

  it("does not re-seed when updating an existing company name match", async () => {
    const { supabaseService, configService } = infra();
    const seedFromCurrentQuotationBase = jest.fn();
    const prisma: any = {
      customer_companies: {
        findUnique: jest.fn().mockResolvedValue({ id: "c-existing" }),
        upsert: jest.fn().mockResolvedValue({ ...companyRow, id: "c-existing" }),
      },
      $transaction: jest.fn(),
    };
    const svc = new CustomersService(
      prisma,
      supabaseService,
      configService,
      { log: jest.fn() } as any,
      undefined,
      { seedFromCurrentQuotationBase } as any,
    );

    const res = await svc.createCompany("t1", { name: "Acme" }, "u1");
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(seedFromCurrentQuotationBase).not.toHaveBeenCalled();
    expect(prisma.customer_companies.upsert).toHaveBeenCalled();
    expect(res.seededCustomerRateTemplate).toBeNull();
  });
});
