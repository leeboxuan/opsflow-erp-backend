import { BadRequestException } from "@nestjs/common";
import { JobStatus } from "@prisma/client";
import { InvoicesService } from "./invoices.service";

describe("InvoicesService Wisdom Force flow", () => {
  function makeService(overrides?: Partial<any>) {
    const prisma: any = {
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
        findMany: jest.fn().mockResolvedValue([]),
      },
      invoice: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce(null) // generated
          .mockResolvedValueOnce(null), // draft
        findMany: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
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
        create: jest.fn().mockResolvedValue({
          id: "doc1",
          customerCompanyId: "c1",
          sourceJobId: "job1",
          sourceInvoiceId: "inv1",
          type: "INVOICE",
          fileName: "WFL-LCL-2604-0077-INVOICE.pdf",
          mimeType: "application/pdf",
          storageKey: "t1/companies/c1/documents/x.pdf",
          generatedByUserId: "u1",
          generatedAt: new Date("2026-05-07T01:00:00.000Z"),
          createdAt: new Date("2026-05-07T01:00:00.000Z"),
          generatedBy: { name: "Ops User", email: "ops@example.com" },
        }),
      },
      ...overrides,
    };
    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({
        storage: {
          from: jest.fn().mockReturnValue({
            upload: jest.fn().mockResolvedValue({ error: null }),
          }),
        },
      }),
    };
    const audit: any = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new InvoicesService(prisma, supabaseService, audit);
    return { svc, prisma };
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

  it("lists invoiceable jobs for company and excludes cancelled/not-ready/generated", async () => {
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
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: "inv-issued", status: "Issued" }) // for job-ready -> excluded
          .mockResolvedValue(null),
      },
    });
    const res = await svc.listInvoiceableJobsByCompany("t1", "c1", {
      userId: "u1",
      role: "OPS",
    });
    expect(res.items).toEqual([]);
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
        findFirst: jest.fn().mockResolvedValue(null),
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

  it("generates PDF and stores company document with job-ref filename", async () => {
    const { svc, prisma } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv1",
          tenantId: "t1",
          invoiceNo: "INV-1",
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
        update: jest.fn().mockResolvedValue({}),
      },
    });
    const result = await svc.generateInvoicePdf("t1", "inv1", {
      userId: "u1",
      role: "OPS",
    });
    expect(result.document.fileName).toBe("WFL-LCL-2604-0077-INVOICE.pdf");
    expect(prisma.customerCompanyDocument.create).toHaveBeenCalled();
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
          status: "Draft",
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
          status: "Draft",
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
});
