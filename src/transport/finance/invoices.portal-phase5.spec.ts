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

    const prisma: any = {
      customer_companies: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => {
          if (where?.id === "co-a" && where?.tenantId === "tenant-a") {
            return {
              id: "co-a",
              name: "Acme",
              normalizedName: "acme",
            };
          }
          return null;
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: "inv-a" }]),
      invoice: {
        findMany: jest.fn().mockResolvedValue(
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
          ],
        ),
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

  it("scopes portal list to the requesting tenant and visible ids only", async () => {
    const { svc, prisma } = makePortalService();
    await svc.listPortalInvoices("tenant-a", "co-a");
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(prisma.$queryRaw.mock.calls[0][0].values).toContain("tenant-a");
    expect(prisma.$queryRaw.mock.calls[0][0].values).toContain("co-a");
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-a", id: { in: ["inv-a"] } },
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
            orders: [{ id: "ord-1" }],
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
            totalCents: 128500,
            issuedByUserId: "u1",
            snapshot: null,
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
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          id: true,
          invoiceNo: true,
          customerName: true,
          status: true,
          totalCents: true,
          currency: true,
          issueDate: true,
        }),
      }),
    );
    expect(prisma.invoice.findMany.mock.calls[0][0].select.lineItems).toBeUndefined();
    expect(prisma.invoice.findMany.mock.calls[0][0].include).toBeUndefined();
    expect(res.data[0].lineItems).toEqual([]);
    expect(res.data[0].invoiceNo).toBe("A-1");
    expect(res.data[0].status).toBe("DRAFT");
    expect(res.data[1].totalCents).toBe(128500);
    expect(res.data).toHaveLength(2);
  });

  it("paginates customer invoices after SQL visibility, not before", async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: "inv-visible",
        invoiceNo: "A-1",
        customerName: "Acme",
        currency: "SGD",
        status: "ISSUED",
        issueDate: new Date(),
        dueDate: null,
        notes: null,
        subtotalCents: 100,
        taxCents: 0,
        totalCents: 100,
        snapshot: null,
        orders: [{ id: "ord-1" }],
      },
    ]);
    const prisma: any = {
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ c: 40n }])
        .mockResolvedValueOnce([{ id: "inv-visible" }]),
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({
          id: "co-a",
          normalizedName: "acme",
        }),
      },
      invoice: { count: jest.fn(), findMany },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new InvoicesService(prisma, { getClient: jest.fn() } as any, {
      log: jest.fn(),
    } as any);

    const res = await svc.listInvoices(
      "tenant-a",
      { page: 2, pageSize: 20 },
      {
        userId: "cust",
        roles: ["CUSTOMER_ADMIN"],
        customerCompanyId: "co-a",
      },
    );

    expect(res.meta.total).toBe(40);
    expect(res.meta.page).toBe(2);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].id).toBe("inv-visible");
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tenantId: "tenant-a", id: { in: ["inv-visible"] } },
      }),
    );
    expect(prisma.$queryRaw.mock.calls[1][0].values).toEqual(
      expect.arrayContaining(["tenant-a", "co-a", 20, 20]),
    );
    expect(findMany.mock.calls[0][0].select.lineItems).toBeUndefined();
  });

  it("customer invoice SQL is tenant- and company-scoped", async () => {
    const prisma: any = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([{ c: 0n }])
        .mockResolvedValueOnce([]),
      customer_companies: {
        findFirst: jest.fn().mockResolvedValue({
          id: "co-a",
          normalizedName: "acme",
        }),
      },
      invoice: { findMany: jest.fn() },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = new InvoicesService(prisma, { getClient: jest.fn() } as any, {
      log: jest.fn(),
    } as any);

    const res = await svc.listInvoices(
      "tenant-a",
      { page: 1, pageSize: 20 },
      {
        roles: ["CUSTOMER_ADMIN"],
        customerCompanyId: "co-a",
      },
    );
    expect(res.meta.total).toBe(0);
    expect(res.data).toEqual([]);
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
    expect(prisma.customer_companies.findFirst).toHaveBeenCalledWith({
      where: { id: "co-a", tenantId: "tenant-a" },
      select: { normalizedName: true },
    });
    expect(prisma.$queryRaw.mock.calls[0][0].values).toContain("tenant-a");
    expect(prisma.$queryRaw.mock.calls[0][0].values).toContain("co-a");
    expect(prisma.$queryRaw.mock.calls[0][0].values).not.toContain("tenant-b");
  });
});
