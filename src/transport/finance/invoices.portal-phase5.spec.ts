import { NotFoundException } from "@nestjs/common";
import { InvoicesService } from "./invoices.service";

describe("InvoicesService portal Phase 5", () => {
  function makePortalService(opts?: {
    downloadError?: boolean;
    invoices?: any[];
  }) {
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: "https://example.com/signed" },
      error: null,
    });
    const download = jest.fn().mockResolvedValue(
      opts?.downloadError
        ? { data: null, error: { message: "not found" } }
        : { data: Buffer.from("%PDF-1.4"), error: null },
    );
    const from = jest.fn().mockReturnValue({ createSignedUrl, download });

    const invoiceUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
    const invoiceFindMany = jest.fn().mockResolvedValue(
      opts?.invoices ?? [
        {
          id: "inv-a",
          tenantId: "tenant-a",
          invoiceNo: "INV-001",
          issueDate: new Date("2026-05-01"),
          dueDate: null,
          status: "ISSUED",
          currency: "SGD",
          subtotalCents: 1000,
          taxCents: 0,
          totalCents: 1000,
          pdfKey: "tenant-a/invoices/inv-a/INV-001.pdf",
          createdAt: new Date("2026-05-01"),
          snapshot: null,
          orders: [{ customerCompanyId: "co-a", customerCompany: { name: "Acme" } }],
        },
        {
          id: "inv-b",
          tenantId: "tenant-a",
          invoiceNo: "INV-002",
          issueDate: new Date("2026-05-02"),
          dueDate: null,
          status: "ISSUED",
          currency: "SGD",
          subtotalCents: 2000,
          taxCents: 0,
          totalCents: 2000,
          pdfKey: "tenant-a/invoices/inv-b/INV-002.pdf",
          createdAt: new Date("2026-05-02"),
          snapshot: null,
          orders: [{ customerCompanyId: "co-b", customerCompany: { name: "Other Co" } }],
        },
      ],
    );

    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({ id: "co-a", name: "Acme" }),
      },
      invoice: {
        findMany: invoiceFindMany,
        findFirst: jest.fn().mockResolvedValue({
          id: "inv-a",
          customerName: "Acme",
          invoiceNo: "INV-001",
          pdfKey: "tenant-a/invoices/inv-a/INV-001.pdf",
          snapshot: null,
          orders: [{ customerCompanyId: "co-a" }],
        }),
        updateMany: invoiceUpdateMany,
      },
      transportOrder: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const supabaseService: any = {
      getClient: jest.fn().mockReturnValue({ storage: { from } }),
    };
    const audit: any = { log: jest.fn() };
    const svc = new InvoicesService(prisma, supabaseService, audit);
    return { svc, prisma, createSignedUrl, download, from, invoiceUpdateMany };
  }

  it("lists portal invoices without per-row storage/PDF existence probes", async () => {
    const { svc, createSignedUrl, download, from } = makePortalService();
    const rows = await svc.listPortalInvoices("tenant-a", "co-a");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "inv-a",
      hasPdf: true,
      customerCompany: { name: "Acme" },
    });
    expect(from).not.toHaveBeenCalled();
    expect(createSignedUrl).not.toHaveBeenCalled();
    expect(download).not.toHaveBeenCalled();
  });

  it("scopes portal list findMany to the requesting tenant", async () => {
    const { svc, prisma } = makePortalService();
    await svc.listPortalInvoices("tenant-a", "co-a");
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-a" }),
      }),
    );
  });

  it("hides portal PDF download for another customer company", async () => {
    const { svc } = makePortalService();
    await expect(
      svc.downloadPortalInvoicePdf("tenant-a", "inv-a", "co-other"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("clears stale pdfKey when portal download finds a missing blob", async () => {
    const { svc, invoiceUpdateMany, download } = makePortalService({
      downloadError: true,
    });

    await expect(
      svc.downloadPortalInvoicePdf("tenant-a", "inv-a", "co-a"),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(download).toHaveBeenCalled();
    expect(invoiceUpdateMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-a",
        id: "inv-a",
        pdfKey: "tenant-a/invoices/inv-a/INV-001.pdf",
      },
      data: { pdfKey: null },
    });
  });

  it("batches staff invoice user name lookups once per page", async () => {
    const userFindMany = jest.fn().mockResolvedValue([
      { id: "u1", name: "Ops One", email: "ops1@example.com" },
      { id: "u2", name: "Ops Two", email: "ops2@example.com" },
    ]);
    const prisma: any = {
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      invoice: {
        count: jest.fn().mockResolvedValue(2),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "inv-1",
            invoiceNo: "A-1",
            customerName: "Acme",
            currency: "SGD",
            status: "DRAFT",
            issueDate: new Date(),
            dueDate: null,
            notes: null,
            subtotalCents: 0,
            taxCents: 0,
            totalCents: 0,
            issuedByUserId: "u1",
            snapshot: { confirmedByUserId: "u2" },
            lineItems: [{ id: "li1", description: "x", qty: 1, unitPriceCents: 1, amountCents: 1, taxCode: null, taxRate: 0, taxCents: 0 }],
            orders: [],
          },
          {
            id: "inv-2",
            invoiceNo: "A-2",
            customerName: "Acme",
            currency: "SGD",
            status: "DRAFT",
            issueDate: new Date(),
            dueDate: null,
            notes: null,
            subtotalCents: 0,
            taxCents: 0,
            totalCents: 0,
            issuedByUserId: "u1",
            snapshot: null,
            lineItems: [],
            orders: [],
          },
        ]),
      },
      user: { findMany: userFindMany },
    };
    const supabaseService: any = { getClient: jest.fn() };
    const audit: any = { log: jest.fn() };
    const svc = new InvoicesService(prisma, supabaseService, audit);

    const res = await svc.listInvoices("tenant-a", {}, { userId: "staff", role: "OPS" });
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(userFindMany).toHaveBeenCalledWith({
      where: { id: { in: expect.arrayContaining(["u1", "u2"]) } },
      select: { id: true, name: true, email: true },
    });
    expect(res.data[0].lineItems).toHaveLength(1);
    expect(res.data).toHaveLength(2);
  });
});
