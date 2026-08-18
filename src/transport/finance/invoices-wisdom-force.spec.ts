import { BadRequestException } from "@nestjs/common";
import { JobStatus } from "@prisma/client";
import { InvoicesService } from "./invoices.service";

describe("InvoicesService Wisdom Force flow", () => {
  function makeService(overrides?: Partial<any>) {
    const uploadedFiles: Array<{ bucket: string; key: string }> = [];
    const removedFiles: string[][] = [];
    const upload = jest.fn().mockResolvedValue({ error: null });
    const remove = jest.fn().mockImplementation((keys: string[]) => {
      removedFiles.push(keys);
      return Promise.resolve({ error: null });
    });
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: "https://example.com/signed" },
      error: null,
    });
    const download = jest
      .fn()
      .mockResolvedValue({ data: Buffer.from("pdf"), error: null });
    const from = jest.fn().mockImplementation((bucket: string) => ({
      upload: (key: string, ...args: any[]) => {
        uploadedFiles.push({ bucket, key });
        return upload(key, ...args);
      },
      remove,
      createSignedUrl,
      download,
    }));

    const prisma: any = {
      $transaction: jest.fn(async (callback: any) => callback(prisma)),
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          internalRef: "WFL-LCL-2604-0077",
          externalRef: "CUST-REF",
          customerCompanyId: "c1",
          customerCompany: { id: "c1", name: "Wisdom Customer" },
          jobType: "LCL",
          status: JobStatus.READY_FOR_INVOICE,
          invoiceReadyAt: new Date("2026-05-07T00:00:00.000Z"),
          trips: [{ id: "t1", status: "DONE", displayTitle: "Trip A" }],
        }),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const ids: string[] = where?.id?.in ?? (where?.id ? [where.id] : []);
          return ids.map((id: string) => ({
            id,
            customerCompanyId: "c1",
          }));
        }),
      },
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null) // generated
          .mockResolvedValueOnce(null), // draft
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({
          id: "inv1",
          status: "DRAFT",
          pdfKey: "t1/invoices/inv1/WFL-LCL-2604-0077-INVOICE.pdf",
          pdfGeneratedAt: new Date("2026-05-07T01:00:00.000Z"),
          lineItems: [],
          orders: [],
        }),
      },
      invoiceLineItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      jobCharge: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      invoiceChargeReservation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 0 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      customerRateMasterLine: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "rm1",
            code: "A_1",
            label: "Container haulage",
            rateCents: 18000,
            requiresManualAmount: false,
            tripMode: null,
          },
        ]),
      },
      customerQuotationRateLine: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      masterRateDatasetRow: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({
          id: "c1",
          name: "Wisdom Customer",
          billingSameAsAddress: false,
          billingAddressLine1: "10 Billing Road",
          billingAddressLine2: null,
          billingPostalCode: "123456",
          billingCountry: "SG",
        }),
      },
      customerCompanyDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({
          id: "doc1",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          sourceInvoiceId: "inv1",
          type: "INVOICE",
          fileName: "WFL-LCL-2604-0077-INVOICE.pdf",
          mimeType: "application/pdf",
          storageKey: "t1/invoices/inv1/WFL-LCL-2604-0077-INVOICE.pdf",
          generatedByUserId: "u1",
          generatedAt: new Date("2026-05-07T01:00:00.000Z"),
          createdAt: new Date("2026-05-07T01:00:00.000Z"),
          generatedBy: { name: "Ops User", email: "ops@example.com" },
        }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn().mockResolvedValue({
          id: "doc1",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          sourceInvoiceId: "inv1",
          type: "INVOICE",
          fileName: "WFL-LCL-2604-0077-INVOICE.pdf",
          mimeType: "application/pdf",
          storageKey: "t1/invoices/inv1/WFL-LCL-2604-0077-INVOICE.pdf",
          generatedByUserId: "u1",
          generatedAt: new Date("2026-05-07T01:00:00.000Z"),
          createdAt: new Date("2026-05-07T01:00:00.000Z"),
          generatedBy: { name: "Ops User", email: "ops@example.com" },
        }),
      },
    };
    if (overrides) {
      for (const [key, value] of Object.entries(overrides)) {
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          prisma[key] &&
          typeof prisma[key] === "object" &&
          !Array.isArray(prisma[key])
        ) {
          prisma[key] = { ...prisma[key], ...value };
        } else {
          prisma[key] = value;
        }
      }
    }
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from,
        },
      }),
    };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new InvoicesService(prisma, supabaseService, audit);
    return {
      svc,
      prisma,
      supabase: {
        from,
        upload,
        remove,
        createSignedUrl,
        download,
        uploadedFiles,
        removedFiles,
      },
    };
  }

  it("builds invoice prefill from billable trips (completed/done only)", async () => {
    const { svc } = makeService();
    const result = await svc.getInvoicePrefillFromJob("t1", "job1", {
      userId: "u1",
      role: "OPS",
    });
    expect(result.invoiceTemplate).toBe("WISDOM_FORCE");
    expect(result.internalJobReference).toBe("WFL-LCL-2604-0077");
    expect(result.lineItems.length).toBe(1);
    expect(result.lineItems[0].sourceType).toBe("TRIP");
    expect(result.lineItems[0].description).toContain("From:");
    expect(result.lineItems[0].description).toContain("To:");
    expect(result.lineItems[0].requiresManualAmount).toBe(true);
    expect(Array.isArray(result.quotationOptions)).toBe(true);
    expect(result.job?.billableTripCount).toBe(1);
  });

  it("lists invoiceable jobs for company and excludes cancelled/not-ready jobs", async () => {
    const { svc, prisma } = makeService({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "job-ready",
            internalRef: "WFL-READY",
            externalRef: "REF-1",
            jobType: "LCL",
            status: "READY_FOR_INVOICE",
            invoiceReadyAt: new Date("2026-05-01T00:00:00.000Z"),
            trips: [{ id: "t1", status: "DONE" }],
          },
          {
            id: "job-cancelled",
            internalRef: "WFL-CANCELLED",
            externalRef: null,
            jobType: "LCL",
            status: "CANCELLED",
            invoiceReadyAt: null,
            trips: [{ id: "t2", status: "CANCELLED" }],
          },
          {
            id: "job-not-ready",
            internalRef: "WFL-NR",
            externalRef: null,
            jobType: "LCL",
            status: "ONGOING",
            invoiceReadyAt: null,
            trips: [{ id: "t3", status: "PUBLISHED" }],
          },
        ]),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          { id: "inv-issued", status: "ISSUED", sourceJobId: "job-ready" },
        ]),
      },
    });
    const res = await svc.listInvoiceableJobsByCompany("t1", "c1", {
      userId: "u1",
      role: "OPS",
    });
    expect(res.items.map((item: any) => item.id)).toEqual(["job-ready"]);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "t1",
          sourceJobId: { in: ["job-ready", "job-cancelled", "job-not-ready"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, status: true, sourceJobId: true },
      }),
    );
    expect(prisma.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("excludes jobs only when every JobCharge is already reserved", async () => {
    const { svc } = makeService({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "job-sent",
            internalRef: "WFL-SENT",
            externalRef: "REF-S",
            jobType: "LCL",
            status: "READY_FOR_INVOICE",
            invoiceReadyAt: new Date("2026-05-01T00:00:00.000Z"),
            trips: [{ id: "t1", status: "DONE" }],
          },
        ]),
      },
      jobCharge: {
        findMany: jest.fn().mockResolvedValue([
          { id: "jc-1", jobId: "job-sent" },
        ]),
      },
      invoiceChargeReservation: {
        findMany: jest.fn().mockResolvedValue([{ jobChargeId: "jc-1" }]),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          { id: "inv-sent", status: "ISSUED", sourceJobId: "job-sent" },
        ]),
      },
    });
    const res = await svc.listInvoiceableJobsByCompany("t1", "c1", {
      userId: "u1",
      role: "OPS",
    });
    expect(res.items).toEqual([]);
  });

  it("includes invoiceable jobs that only have a draft existing invoice", async () => {
    const { svc } = makeService({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "job-draft",
            internalRef: "WFL-DRAFT",
            externalRef: "REF-D",
            jobType: "LCL",
            status: "READY_FOR_INVOICE",
            invoiceReadyAt: new Date("2026-05-01T00:00:00.000Z"),
            trips: [{ id: "t1", status: "DONE" }],
          },
        ]),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([
          { id: "inv-draft", status: "DRAFT", sourceJobId: "job-draft" },
        ]),
      },
    });
    const res = await svc.listInvoiceableJobsByCompany("t1", "c1", {
      userId: "u1",
      role: "OPS",
    });
    expect(res.items).toEqual([
      expect.objectContaining({
        id: "job-draft",
        internalJobReference: "WFL-DRAFT",
        customerReference: "REF-D",
        jobType: "LCL",
        status: "READY_FOR_INVOICE",
        tripCount: 1,
        completedTripCount: 1,
        billableTripCount: 1,
        existingInvoiceId: "inv-draft",
        existingInvoiceStatus: "DRAFT",
        label: "WFL-DRAFT · REF-D · LCL",
      }),
    ]);
  });

  it("returns empty invoiceable jobs when company has no jobs", async () => {
    const { svc, prisma } = makeService({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      invoice: {
        findMany: jest.fn(),
      },
    });
    const res = await svc.listInvoiceableJobsByCompany("t1", "c1", {
      userId: "u1",
      role: "OPS",
    });
    expect(res.items).toEqual([]);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  it("rejects invoiceable jobs when tenant company is not found", async () => {
    const { svc } = makeService({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    });
    await expect(
      svc.listInvoiceableJobsByCompany("t1", "missing-company", {
        userId: "u1",
        role: "OPS",
      }),
    ).rejects.toThrow("Customer company not found");
  });

  it("invoiceable jobs returns billableTripCount", async () => {
    const { svc } = makeService({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
      job: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "job-ready",
            internalRef: "WFL-READY",
            externalRef: "REF-1",
            jobType: "LCL",
            status: "READY_FOR_INVOICE",
            invoiceReadyAt: new Date("2026-05-01T00:00:00.000Z"),
            trips: [
              { id: "t1", status: "DONE" },
              { id: "t2", status: "COMPLETED" },
              { id: "t3", status: "CANCELLED" },
            ],
          },
        ]),
      },
      invoice: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    });
    const res = await svc.listInvoiceableJobsByCompany("t1", "c1", {
      userId: "u1",
      role: "OPS",
    });
    expect(res.items.length).toBe(1);
    expect(res.items[0].billableTripCount).toBe(2);
  });

  it("lists quotation options without DRIVER_PAYOUT usage", async () => {
    const { svc, prisma } = makeService({
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "c1" }),
      },
    });
    const res = await svc.listQuotationOptionsByCompany("t1", "c1", {
      userId: "u1",
      role: "OPS",
    });
    expect(res.items.length).toBeGreaterThan(0);
    expect(prisma.driverPayoutItem).toBeUndefined();
  });

  it("falls back to tenant quotation dataset when company sources are empty", async () => {
    const { svc } = makeService({
      customer_companies: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
      customerRateMasterLine: { findMany: jest.fn().mockResolvedValue([]) },
      customerQuotationRateLine: { findMany: jest.fn().mockResolvedValue([]) },
      masterRateDatasetRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "dq1",
            code: "A_1",
            label: "Round Trip Charges",
            description: null,
            unit: null,
            rateCents: null,
            requiresManualAmount: true,
            rawRateText: "140\n170",
            dataset: { id: "dataset-q-1" },
          },
        ]),
      },
    });
    const res = await svc.listQuotationOptionsByCompany("t1", "c1", {
      userId: "u1",
      role: "OPS",
    });
    expect(res.items.length).toBe(1);
    expect(res.items[0]).toMatchObject({
      id: "dq1",
      code: "A_1",
      unitPriceCents: null,
      requiresManualAmount: true,
      sourceMasterFileId: "dataset-q-1",
    });
  });

  it("enforces tenant-scoped company validation for quotation options", async () => {
    const { svc } = makeService({
      customer_companies: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    await expect(
      svc.listQuotationOptionsByCompany("t1", "c999", {
        userId: "u1",
        role: "OPS",
      }),
    ).rejects.toThrow("Customer company not found");
  });

  it("blocks prefill when job is not ready for invoice", async () => {
    const { svc } = makeService({
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          status: "ONGOING",
          invoiceReadyAt: null,
        }),
      },
    });
    await expect(
      svc.getInvoicePrefillFromJob("t1", "job1", { userId: "u1", role: "OPS" }),
    ).rejects.toThrow("Job is not ready for invoice");
  });

  it("blocks PDF generation when required manual amount is missing", async () => {
    const { svc } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv1",
          tenantId: "t1",
          invoiceNo: "INV-1",
          status: "DRAFT",
          customerName: "Customer",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          lineItems: [
            {
              description: "Manual item",
              qty: 1,
              unitPriceCents: 0,
              amountCents: 0,
              taxRate: 900,
              requiresManualAmount: true,
            },
          ],
          subtotalCents: 0,
          taxCents: 0,
          totalCents: 0,
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          orders: [],
        }),
      },
    });
    await expect(
      svc.generateInvoicePdf("t1", "inv1", { userId: "u1", role: "OPS" }),
    ).rejects.toThrow(BadRequestException);
  });

  it("generates PDF into invoice-documents and stores invoice metadata record", async () => {
    const { svc, prisma, supabase } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv1",
          tenantId: "t1",
          invoiceNo: "INV-1",
          status: "DRAFT",
          customerName: "Customer",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          lineItems: [
            {
              description: "Item",
              qty: 1,
              unitPriceCents: 18000,
              amountCents: 18000,
              taxRate: 900,
              requiresManualAmount: false,
            },
          ],
          subtotalCents: 18000,
          taxCents: 1620,
          totalCents: 19620,
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          orders: [],
        }),
      },
    });
    const result = await svc.generateInvoicePdf("t1", "inv1", {
      userId: "u1",
      role: "OPS",
    });
    expect(result.document.fileName).toBe("WFL-LCL-2604-0077-INVOICE.pdf");
    expect(result.document.storageKey).toBe(
      "t1/invoices/inv1/WFL-LCL-2604-0077-INVOICE.pdf",
    );
    expect(supabase.uploadedFiles).toContainEqual({
      bucket: "invoice-documents",
      key: "t1/invoices/inv1/WFL-LCL-2604-0077-INVOICE.pdf",
    });
    expect(supabase.from).not.toHaveBeenCalledWith("company-documents");
    expect(supabase.from).not.toHaveBeenCalledWith("job-documents");
    expect(prisma.customerCompanyDocument.create).toHaveBeenCalled();
    expect(prisma.invoice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pdfKey: "t1/invoices/inv1/WFL-LCL-2604-0077-INVOICE.pdf",
          pdfGeneratedAt: expect.any(Date),
        }),
      }),
    );
  });

  it("returns a clear bucket-missing error and does not update invoice metadata", async () => {
    const { svc, prisma, supabase } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv1",
          tenantId: "t1",
          invoiceNo: "INV-1",
          status: "DRAFT",
          customerName: "Customer",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          lineItems: [
            {
              description: "Item",
              qty: 1,
              unitPriceCents: 18000,
              amountCents: 18000,
              taxRate: 900,
              requiresManualAmount: false,
            },
          ],
          subtotalCents: 18000,
          taxCents: 1620,
          totalCents: 19620,
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          orders: [],
        }),
      },
    });
    supabase.upload.mockResolvedValueOnce({
      error: { message: "Bucket not found" },
    });

    await expect(
      svc.generateInvoicePdf("t1", "inv1", { userId: "u1", role: "OPS" }),
    ).rejects.toThrow(
      "Storage bucket 'invoice-documents' does not exist. Create it in Supabase Storage.",
    );
    expect(prisma.customerCompanyDocument.create).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("does not update invoice pdf fields when document metadata creation fails", async () => {
    const { svc, prisma } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv1",
          tenantId: "t1",
          invoiceNo: "INV-1",
          status: "DRAFT",
          customerName: "Customer",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          lineItems: [
            {
              description: "Item",
              qty: 1,
              unitPriceCents: 18000,
              amountCents: 18000,
              taxRate: 900,
              requiresManualAmount: false,
            },
          ],
          subtotalCents: 18000,
          taxCents: 1620,
          totalCents: 19620,
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          orders: [],
        }),
      },
      customerCompanyDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockRejectedValue(new Error("document insert failed")),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    });

    await expect(
      svc.generateInvoicePdf("t1", "inv1", { userId: "u1", role: "OPS" }),
    ).rejects.toThrow("document insert failed");
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  it("uploadInvoicePdf uses invoice-documents with stable invoice path and filename", async () => {
    const { svc, prisma, supabase } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv1",
          tenantId: "t1",
          invoiceNo: "INV-1",
          status: "DRAFT",
          customerName: "Customer",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          orders: [],
        }),
        update: jest.fn().mockResolvedValue({
          id: "inv1",
          invoiceNo: "INV-1",
          status: "DRAFT",
          customerName: "Customer",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          notes: null,
          subtotalCents: 0,
          taxCents: 0,
          totalCents: 0,
          lineItems: [],
          orders: [],
          snapshot: {},
          pdfKey: "t1/invoices/inv1/WFL-LCL-2604-0077-INVOICE.pdf",
          pdfGeneratedAt: new Date("2026-05-07T01:00:00.000Z"),
        }),
      },
    });

    await svc.uploadInvoicePdf(
      "t1",
      "inv1",
      {
        mimetype: "application/pdf",
        buffer: Buffer.from("pdf"),
      } as any,
      { userId: "u1", role: "OPS" },
    );

    expect(supabase.uploadedFiles).toContainEqual({
      bucket: "invoice-documents",
      key: "t1/invoices/inv1/WFL-LCL-2604-0077-INVOICE.pdf",
    });
    expect(supabase.from).not.toHaveBeenCalledWith("company-documents");
    expect(supabase.from).not.toHaveBeenCalledWith("job-documents");
    expect(prisma.customerCompanyDocument.create).toHaveBeenCalled();
    expect(prisma.invoice.update).toHaveBeenCalled();
  });

  it("regenerating a PDF updates existing invoice document instead of creating duplicates", async () => {
    const { svc, prisma } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv1",
          tenantId: "t1",
          invoiceNo: "INV-1",
          status: "DRAFT",
          customerName: "Customer",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          lineItems: [
            {
              description: "Item",
              qty: 1,
              unitPriceCents: 18000,
              amountCents: 18000,
              taxRate: 900,
              requiresManualAmount: false,
            },
          ],
          subtotalCents: 18000,
          taxCents: 1620,
          totalCents: 19620,
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          orders: [],
          pdfKey: "t1/invoices/inv1/old-INVOICE.pdf",
        }),
      },
      customerCompanyDocument: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "doc-existing",
            storageKey: "t1/invoices/inv1/old-INVOICE.pdf",
            status: "ACTIVE",
          },
        ]),
        update: jest.fn().mockResolvedValue({
          id: "doc-existing",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          sourceInvoiceId: "inv1",
          type: "INVOICE",
          fileName: "WFL-LCL-2604-0077-INVOICE.pdf",
          mimeType: "application/pdf",
          storageKey: "t1/invoices/inv1/WFL-LCL-2604-0077-INVOICE.pdf",
          generatedByUserId: "u1",
          generatedAt: new Date("2026-05-07T01:00:00.000Z"),
          createdAt: new Date("2026-05-07T01:00:00.000Z"),
          generatedBy: { name: "Ops User", email: "ops@example.com" },
        }),
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    });

    await svc.generateInvoicePdf("t1", "inv1", { userId: "u1", role: "OPS" });

    expect(prisma.customerCompanyDocument.update).toHaveBeenCalled();
    expect(prisma.customerCompanyDocument.create).not.toHaveBeenCalled();
  });

  it("create draft accepts MANUAL line item sourceType", async () => {
    const { svc, prisma } = makeService({
      invoice: {
        ...makeService().prisma.invoice,
        create: jest.fn().mockResolvedValue({
          id: "inv-d1",
          invoiceNo: "INV-202605-0001",
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: null,
          templateCode: "WISDOM_FORCE",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          notes: null,
          subtotalCents: 10000,
          taxCents: 900,
          totalCents: 10900,
          lineItems: [
            {
              id: "li1",
              description: "Manual service",
              qty: 1,
              unitPriceCents: 10000,
              amountCents: 10000,
              taxCode: "SR",
              taxRate: 900,
              taxCents: 900,
              sourceType: "MANUAL",
              sourceMasterItemId: null,
              requiresManualAmount: false,
            },
          ],
          orders: [],
          snapshot: { orderIds: [], sourceJobIds: [] },
        }),
      },
    });
    await expect(
      svc.createDraftInvoice(
        "t1",
        {
          customerName: "Customer A",
          customerCompanyId: "c1",
          templateCode: "WISDOM_FORCE",
          lineItems: [
            {
              description: "Manual service",
              qty: 1,
              unitPriceCents: 10000,
              taxCode: "SR",
              taxRate: 900,
              sourceType: "MANUAL",
            },
          ],
        } as any,
        { userId: "u1", role: "OPS" },
      ),
    ).resolves.toBeTruthy();
    expect(prisma.invoice.create).toHaveBeenCalled();
  });

  it("accepts TRIP source line without quotation master item", async () => {
    const { svc, prisma } = makeService({
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip-1", status: "DONE" }),
      },
      invoice: {
        ...makeService().prisma.invoice,
        create: jest.fn().mockResolvedValue({
          id: "inv-d2",
          invoiceNo: "INV-202605-0002",
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          notes: null,
          subtotalCents: 0,
          taxCents: 0,
          totalCents: 0,
          lineItems: [
            {
              id: "li2",
              description: "WF-0002-IMP-T01\nFrom: A\nTo: B",
              qty: 1,
              unitPriceCents: 0,
              amountCents: 0,
              taxCode: "SR",
              taxRate: 900,
              taxCents: 0,
              sourceType: "TRIP",
              sourceMasterItemId: null,
              sourceTripId: "trip-1",
              tripDisplayRefSnapshot: "WF-0002-IMP-T01",
              requiresManualAmount: true,
            },
          ],
          orders: [],
          snapshot: { orderIds: [], sourceJobIds: [] },
        }),
      },
    });
    await expect(
      svc.createDraftInvoice(
        "t1",
        {
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          lineItems: [
            {
              description: "WF-0002-IMP-T01\nFrom: A\nTo: B",
              qty: 1,
              unitPriceCents: null,
              taxCode: "SR",
              taxRate: 900,
              sourceType: "TRIP",
              sourceTripId: "trip-1",
              tripDisplayRef: "WF-0002-IMP-T01",
              requiresManualAmount: true,
            },
          ],
        } as any,
        { userId: "u1", role: "OPS" },
      ),
    ).resolves.toBeTruthy();
    expect(prisma.invoice.create).toHaveBeenCalled();
  });

  it("accepts QUOTATION_MASTER from tenant quotation dataset fallback", async () => {
    const { svc, prisma } = makeService({
      customerRateMasterLine: { findMany: jest.fn().mockResolvedValue([]) },
      customerQuotationRateLine: { findMany: jest.fn().mockResolvedValue([]) },
      masterRateDatasetRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "dataset-row-1",
            code: "A_1",
            label: "One Way Charges",
            description: null,
            unit: "trip",
            rateCents: 8000,
            requiresManualAmount: false,
            rawRateText: null,
            dataset: { id: "dataset-q-1" },
          },
        ]),
      },
      invoice: {
        ...makeService().prisma.invoice,
        create: jest.fn().mockResolvedValue({
          id: "inv-d3",
          invoiceNo: "INV-202605-0003",
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          notes: null,
          subtotalCents: 8000,
          taxCents: 720,
          totalCents: 8720,
          lineItems: [],
          orders: [],
          snapshot: { orderIds: [], sourceJobIds: [] },
        }),
      },
    });
    await expect(
      svc.createDraftInvoice(
        "t1",
        {
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          lineItems: [
            {
              description: "One Way Charges",
              qty: 1,
              unitPriceCents: 8000,
              taxCode: "SR",
              taxRate: 900,
              sourceType: "QUOTATION_MASTER",
              sourceMasterItemId: "dataset-row-1",
              requiresManualAmount: false,
            },
          ],
        } as any,
        { userId: "u1", role: "OPS" },
      ),
    ).resolves.toBeTruthy();
    expect(prisma.invoice.create).toHaveBeenCalled();
  });

  it("rejects invalid quotation source line item id (driver payout/inactive/other tenant)", async () => {
    const { svc } = makeService({
      customerRateMasterLine: { findMany: jest.fn().mockResolvedValue([]) },
      customerQuotationRateLine: { findMany: jest.fn().mockResolvedValue([]) },
      masterRateDatasetRow: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await expect(
      svc.createDraftInvoice(
        "t1",
        {
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          lineItems: [
            {
              description: "Bad quotation source",
              qty: 1,
              unitPriceCents: 1000,
              taxCode: "SR",
              taxRate: 900,
              sourceType: "QUOTATION_MASTER",
              sourceMasterItemId: "driver-payout-or-inactive-or-other-tenant-id",
            },
          ],
        } as any,
        { userId: "u1", role: "OPS" },
      ),
    ).rejects.toThrow("Invalid quotation source line item");
  });

  it("accepts TRIP line with fallback quotation source item", async () => {
    const { svc, prisma } = makeService({
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip-1", status: "DONE" }),
      },
      customerRateMasterLine: { findMany: jest.fn().mockResolvedValue([]) },
      customerQuotationRateLine: { findMany: jest.fn().mockResolvedValue([]) },
      masterRateDatasetRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "dataset-row-trip-pricing",
            code: "A_2",
            label: "One Way Charges",
            description: null,
            unit: "trip",
            rateCents: 8000,
            requiresManualAmount: false,
            rawRateText: null,
            dataset: { id: "dataset-q-1" },
          },
        ]),
      },
      invoice: {
        ...makeService().prisma.invoice,
        create: jest.fn().mockResolvedValue({
          id: "inv-d4",
          invoiceNo: "INV-202605-0004",
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          currency: "SGD",
          issueDate: new Date("2026-05-07T00:00:00.000Z"),
          dueDate: null,
          notes: null,
          subtotalCents: 8000,
          taxCents: 720,
          totalCents: 8720,
          lineItems: [],
          orders: [],
          snapshot: { orderIds: [], sourceJobIds: [] },
        }),
      },
    });
    await expect(
      svc.createDraftInvoice(
        "t1",
        {
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          lineItems: [
            {
              description: "WF-0002-IMP-T01\nFrom: A\nTo: B",
              qty: 1,
              unitPriceCents: 8000,
              taxCode: "SR",
              taxRate: 900,
              sourceType: "TRIP",
              sourceTripId: "trip-1",
              sourceMasterItemId: "dataset-row-trip-pricing",
            },
          ],
        } as any,
        { userId: "u1", role: "OPS" },
      ),
    ).resolves.toBeTruthy();
    expect(prisma.invoice.create).toHaveBeenCalled();
  });

  it("updates draft with TRIP lines without calling PDF render/upload", async () => {
    const existingDraft = {
      id: "inv-upd-1",
      tenantId: "t1",
      invoiceNo: "INV-202605-0005",
      customerName: "Customer A",
      customerCompanyId: "c1",
      sourceJobId: "job1",
      templateCode: "WISDOM_FORCE",
      currency: "SGD",
      status: "DRAFT",
      issueDate: new Date("2026-05-07T00:00:00.000Z"),
      dueDate: null,
      notes: null,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      lineItems: [],
      orders: [],
      snapshot: { orderIds: [], sourceJobIds: ["job1"] },
      pdfKey: "t1/invoices/inv-upd-1/WFL-LCL-2604-0077-INVOICE.pdf",
      pdfGeneratedAt: new Date("2026-05-07T01:00:00.000Z"),
    };
    const updatedDraft = {
      ...existingDraft,
      customerName: "Customer A Updated",
      lineItems: [
        {
          id: "li-upd-1",
          description: "WF-0002-IMP-T01\nFrom: A\nTo: B",
          qty: 1,
          unitPriceCents: 9000,
          amountCents: 9000,
          taxCode: "SR",
          taxRate: 900,
          taxCents: 810,
          sourceType: "TRIP",
          sourceMasterItemId: null,
          sourceTripId: "trip-1",
          tripDisplayRefSnapshot: "WF-0002-IMP-T01",
          requiresManualAmount: false,
        },
      ],
      subtotalCents: 9000,
      taxCents: 810,
      totalCents: 9810,
    };
    const { svc, prisma, supabase } = makeService({
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existingDraft)
          .mockResolvedValueOnce(updatedDraft),
        update: jest.fn().mockResolvedValue({ id: existingDraft.id }),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          internalRef: "WFL-LCL-2604-0077",
          externalRef: "CUST-REF",
          customerCompanyId: "c1",
          customerCompany: { id: "c1", name: "Wisdom Customer" },
          jobType: "LCL",
          status: JobStatus.READY_FOR_INVOICE,
          invoiceReadyAt: new Date("2026-05-07T00:00:00.000Z"),
          trips: [{ id: "t1", status: "DONE", displayTitle: "Trip A" }],
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "job1", customerCompanyId: "c1" }]),
      },
      trip: {
        findFirst: jest.fn().mockResolvedValue({ id: "trip-1", status: "DONE" }),
      },
    });
    const pdfSpy = jest.spyOn<any, any>(svc as any, "createInvoicePdfBuffer");

    const result = await svc.updateDraftInvoice(
      "t1",
      existingDraft.id,
      {
        customerName: "Customer A Updated",
        customerCompanyId: "c1",
        sourceJobId: "job1",
        templateCode: "WISDOM_FORCE",
        lineItems: [
          {
            description: "WF-0002-IMP-T01\nFrom: A\nTo: B",
            qty: 1,
            unitPriceCents: 9000,
            taxCode: "SR",
            taxRate: 900,
            sourceType: "TRIP",
            sourceTripId: "trip-1",
            tripDisplayRef: "WF-0002-IMP-T01",
            requiresManualAmount: false,
          },
        ],
      } as any,
      { userId: "u1", role: "OPS" },
    );

    expect(result.id).toBe(existingDraft.id);
    expect(result.pdfGeneratedAt).toEqual(existingDraft.pdfGeneratedAt);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.invoiceLineItem.deleteMany).toHaveBeenCalled();
    expect(prisma.invoiceLineItem.createMany).toHaveBeenCalled();
    expect(pdfSpy).not.toHaveBeenCalled();
    expect(supabase.upload).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("updates draft with QUOTATION_MASTER fallback and runs validation before transaction", async () => {
    const existingDraft = {
      id: "inv-upd-2",
      tenantId: "t1",
      invoiceNo: "INV-202605-0006",
      customerName: "Customer A",
      customerCompanyId: "c1",
      sourceJobId: "job1",
      templateCode: "WISDOM_FORCE",
      currency: "SGD",
      status: "DRAFT",
      issueDate: new Date("2026-05-07T00:00:00.000Z"),
      dueDate: null,
      notes: null,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      lineItems: [],
      orders: [],
      snapshot: { orderIds: [], sourceJobIds: ["job1"] },
    };
    const updatedDraft = {
      ...existingDraft,
      lineItems: [],
      subtotalCents: 8000,
      taxCents: 720,
      totalCents: 8720,
    };
    const { svc, prisma } = makeService({
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existingDraft)
          .mockResolvedValueOnce(updatedDraft),
        update: jest.fn().mockResolvedValue({ id: existingDraft.id }),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          internalRef: "WFL-LCL-2604-0077",
          externalRef: "CUST-REF",
          customerCompanyId: "c1",
          customerCompany: { id: "c1", name: "Wisdom Customer" },
          jobType: "LCL",
          status: JobStatus.READY_FOR_INVOICE,
          invoiceReadyAt: new Date("2026-05-07T00:00:00.000Z"),
          trips: [{ id: "t1", status: "DONE", displayTitle: "Trip A" }],
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "job1", customerCompanyId: "c1" }]),
      },
      customerRateMasterLine: { findMany: jest.fn().mockResolvedValue([]) },
      customerQuotationRateLine: { findMany: jest.fn().mockResolvedValue([]) },
      masterRateDatasetRow: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "dataset-row-1",
            code: "A_1",
            label: "One Way Charges",
            description: null,
            unit: "trip",
            rateCents: 8000,
            requiresManualAmount: false,
            rawRateText: null,
            dataset: { id: "dataset-q-1" },
          },
        ]),
      },
    });

    await expect(
      svc.updateDraftInvoice(
        "t1",
        existingDraft.id,
        {
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          lineItems: [
            {
              description: "One Way Charges",
              qty: 1,
              unitPriceCents: 8000,
              taxCode: "SR",
              taxRate: 900,
              sourceType: "QUOTATION_MASTER",
              sourceMasterItemId: "dataset-row-1",
            },
          ],
        } as any,
        { userId: "u1", role: "OPS" },
      ),
    ).resolves.toBeTruthy();
    expect(prisma.masterRateDatasetRow.findMany).toHaveBeenCalled();
    expect(
      prisma.masterRateDatasetRow.findMany.mock.invocationCallOrder[0],
    ).toBeLessThan(prisma.$transaction.mock.invocationCallOrder[0]);
  });

  it("updates draft with MANUAL line and allows update when PDF snapshot exists", async () => {
    const existingDraft = {
      id: "inv-upd-3",
      tenantId: "t1",
      invoiceNo: "INV-202605-0007",
      customerName: "Customer A",
      customerCompanyId: "c1",
      sourceJobId: "job1",
      templateCode: "WISDOM_FORCE",
      currency: "SGD",
      status: "DRAFT",
      issueDate: new Date("2026-05-07T00:00:00.000Z"),
      dueDate: null,
      notes: null,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      lineItems: [],
      orders: [],
      snapshot: { orderIds: [], sourceJobIds: ["job1"] },
      pdfKey: "t1/invoices/inv-upd-3/WFL-LCL-2604-0077-INVOICE.pdf",
      pdfGeneratedAt: new Date("2026-05-07T01:00:00.000Z"),
    };
    const updatedDraft = {
      ...existingDraft,
      lineItems: [],
      subtotalCents: 10000,
      taxCents: 900,
      totalCents: 10900,
    };
    const { svc } = makeService({
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(existingDraft)
          .mockResolvedValueOnce(updatedDraft),
        update: jest.fn().mockResolvedValue({ id: existingDraft.id }),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          internalRef: "WFL-LCL-2604-0077",
          externalRef: "CUST-REF",
          customerCompanyId: "c1",
          customerCompany: { id: "c1", name: "Wisdom Customer" },
          jobType: "LCL",
          status: JobStatus.READY_FOR_INVOICE,
          invoiceReadyAt: new Date("2026-05-07T00:00:00.000Z"),
          trips: [{ id: "t1", status: "DONE", displayTitle: "Trip A" }],
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "job1", customerCompanyId: "c1" }]),
      },
    });

    const result = await svc.updateDraftInvoice(
      "t1",
      existingDraft.id,
      {
        customerName: "Customer A",
        customerCompanyId: "c1",
        sourceJobId: "job1",
        templateCode: "WISDOM_FORCE",
        lineItems: [
          {
            description: "Manual service",
            qty: 1,
            unitPriceCents: 10000,
            taxCode: "SR",
            taxRate: 900,
            sourceType: "MANUAL",
          },
        ],
      } as any,
      { userId: "u1", role: "OPS" },
    );

    expect(result.id).toBe(existingDraft.id);
    expect(result.pdfKey).toBe(existingDraft.pdfKey);
    expect(result.pdfGeneratedAt).toEqual(existingDraft.pdfGeneratedAt);
  });

  it("update draft rolls back write result on line-item create failure", async () => {
    const existingDraft = {
      id: "inv-upd-4",
      tenantId: "t1",
      invoiceNo: "INV-202605-0008",
      customerName: "Customer A",
      customerCompanyId: "c1",
      sourceJobId: "job1",
      templateCode: "WISDOM_FORCE",
      currency: "SGD",
      status: "DRAFT",
      issueDate: new Date("2026-05-07T00:00:00.000Z"),
      dueDate: null,
      notes: null,
      subtotalCents: 0,
      taxCents: 0,
      totalCents: 0,
      lineItems: [],
      orders: [],
      snapshot: { orderIds: [], sourceJobIds: ["job1"] },
    };
    const { svc, prisma } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue(existingDraft),
        update: jest.fn().mockResolvedValue({ id: existingDraft.id }),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job1",
          tenantId: "t1",
          internalRef: "WFL-LCL-2604-0077",
          externalRef: "CUST-REF",
          customerCompanyId: "c1",
          customerCompany: { id: "c1", name: "Wisdom Customer" },
          jobType: "LCL",
          status: JobStatus.READY_FOR_INVOICE,
          invoiceReadyAt: new Date("2026-05-07T00:00:00.000Z"),
          trips: [{ id: "t1", status: "DONE", displayTitle: "Trip A" }],
        }),
        findMany: jest.fn().mockResolvedValue([{ id: "job1", customerCompanyId: "c1" }]),
      },
      invoiceLineItem: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockRejectedValue(new Error("line create failed")),
      },
    });

    await expect(
      svc.updateDraftInvoice(
        "t1",
        existingDraft.id,
        {
          customerName: "Customer A",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          templateCode: "WISDOM_FORCE",
          lineItems: [
            {
              description: "Manual service",
              qty: 1,
              unitPriceCents: 10000,
              taxCode: "SR",
              taxRate: 900,
              sourceType: "MANUAL",
            },
          ],
        } as any,
        { userId: "u1", role: "OPS" },
      ),
    ).rejects.toThrow("line create failed");
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
