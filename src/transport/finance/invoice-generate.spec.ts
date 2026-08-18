import { BadRequestException, ConflictException } from "@nestjs/common";
import { InvoicesService } from "./invoices.service";
import { INVOICE_STATUS } from "./invoice-status";

describe("invoice PDF generate atomicity", () => {
  function makeService(opts?: { uploadError?: boolean; txError?: boolean }) {
    const remove = jest.fn().mockResolvedValue({ error: null });
    const upload = jest.fn().mockResolvedValue(
      opts?.uploadError
        ? { error: { message: "upload failed" } }
        : { error: null },
    );
    const invoice = {
      id: "inv-1",
      invoiceNo: "INV-1",
      status: INVOICE_STATUS.DRAFT,
      customerCompanyId: "co-1",
      sourceJobId: "job-1",
      pdfKey: null,
      pdfGeneratedAt: null,
      snapshot: { stage: INVOICE_STATUS.DRAFT },
      lineItems: [
        {
          id: "li-1",
          description: "Haulage",
          qty: 1,
          unitPriceCents: 1000,
          amountCents: 1000,
          taxCode: "SR",
          taxRate: 900,
          taxCents: 90,
          requiresManualAmount: false,
        },
      ],
      orders: [],
    };
    const invoiceUpdate = jest.fn().mockImplementation(({ data }: any) => ({
      ...invoice,
      ...data,
      lineItems: invoice.lineItems,
      orders: [],
    }));
    const prisma: any = {
      $transaction: jest.fn(async (fn: any) => {
        if (opts?.txError) throw new Error("db write failed");
        return fn(prisma);
      }),
      invoice: {
        findFirst: jest.fn().mockResolvedValue(invoice),
        update: invoiceUpdate,
      },
      customerCompanyDocument: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({
          id: "doc-1",
          customerCompanyId: "co-1",
          sourceJobId: "job-1",
          sourceInvoiceId: "inv-1",
          type: "INVOICE",
          fileName: "INV-1.pdf",
          mimeType: "application/pdf",
          storageKey: "k",
          generatedByUserId: "u1",
          generatedBy: { name: "Fin", email: "f@x" },
          generatedAt: new Date(),
          createdAt: new Date(),
        }),
      },
      user: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const supabaseService: any = {
      getClient: () => ({
        storage: { from: () => ({ upload, remove }) },
      }),
    };
    const audit: any = { log: jest.fn() };
    const svc = new InvoicesService(prisma, supabaseService, audit);
    jest
      .spyOn(svc as any, "buildInvoiceRenderData")
      .mockResolvedValue({
        customerCompanyId: "co-1",
        sourceJobId: "job-1",
        sourceJobInternalRef: "JOB-1",
      });
    jest
      .spyOn(svc as any, "createInvoicePdfBuffer")
      .mockResolvedValue(Buffer.from("%PDF-1.4"));
    jest.spyOn(svc as any, "assertCanAccessInvoice").mockResolvedValue(undefined);
    jest.spyOn(svc as any, "assertCustomerCanOnlyRead").mockReturnValue(undefined);
    jest.spyOn(svc as any, "toDtoWithNames").mockImplementation(async (inv: any) => inv);
    return { svc, prisma, invoiceUpdate, upload, remove, audit };
  }

  it("does not persist GENERATED when PDF upload fails", async () => {
    const { svc, invoiceUpdate } = makeService({ uploadError: true });
    await expect(
      svc.generateInvoicePdf("t1", "inv-1", { userId: "u1" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it("removes the uploaded object and does not leave GENERATED when the DB write fails", async () => {
    const { svc, invoiceUpdate, remove } = makeService({ txError: true });
    await expect(
      svc.generateInvoicePdf("t1", "inv-1", { userId: "u1" }),
    ).rejects.toThrow("db write failed");
    expect(invoiceUpdate).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
  });

  it("promotes DRAFT to GENERATED only after PDF persist succeeds", async () => {
    const { svc, invoiceUpdate, audit } = makeService();
    const result = await svc.generateInvoicePdf("t1", "inv-1", { userId: "u1" });
    expect(invoiceUpdate.mock.calls[0][0].data.status).toBe("GENERATED");
    expect(invoiceUpdate.mock.calls[0][0].data.pdfKey).toBeTruthy();
    expect(invoiceUpdate.mock.calls[0][0].data.pdfGeneratedAt).toBeInstanceOf(Date);
    expect(result.status).toBe("GENERATED");
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "INVOICE_GENERATED",
      "INVOICE",
      "inv-1",
      expect.objectContaining({ status: "GENERATED" }),
      "u1",
    );
  });

  it("repeat generate on GENERATED with complete metadata does not rewrite the artifact", async () => {
    const { svc, prisma, invoiceUpdate, upload, audit } = makeService();
    prisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      invoiceNo: "INV-1",
      status: INVOICE_STATUS.GENERATED,
      pdfKey: "frozen.pdf",
      pdfGeneratedAt: new Date("2026-08-17T00:00:00.000Z"),
      lineItems: [],
      orders: [],
    });
    prisma.customerCompanyDocument.findFirst.mockResolvedValue({
      storageKey: "frozen.pdf",
      generatedBy: { name: "Fin" },
    });
    const result = await svc.generateInvoicePdf("t1", "inv-1", { userId: "u1" });
    expect(result.status).toBe("GENERATED");
    expect(invoiceUpdate).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it("fails closed when GENERATED is missing PDF metadata", async () => {
    const { svc, prisma, invoiceUpdate } = makeService();
    prisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      status: INVOICE_STATUS.GENERATED,
      pdfKey: null,
      pdfGeneratedAt: null,
      lineItems: [],
      orders: [],
    });
    await expect(
      svc.generateInvoicePdf("t1", "inv-1", { userId: "u1" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(invoiceUpdate).not.toHaveBeenCalled();
  });

  it("leaves DRAFT unchanged when customerCompanyId is missing", async () => {
    const { svc, invoiceUpdate } = makeService();
    const pdfSpy = jest.spyOn(svc as any, "createInvoicePdfBuffer");
    jest.spyOn(svc as any, "buildInvoiceRenderData").mockResolvedValue({
      customerCompanyId: null,
      sourceJobId: "job-1",
      sourceJobInternalRef: "JOB-1",
    });
    await expect(
      svc.generateInvoicePdf("t1", "inv-1", { userId: "u1" }),
    ).rejects.toThrow("Invoice must have a customerCompanyId before generating a PDF");
    expect(invoiceUpdate).not.toHaveBeenCalled();
    expect(pdfSpy).not.toHaveBeenCalled();
  });

  it("refuses generate on ISSUED, PAID, and VOID", async () => {
    for (const status of [
      INVOICE_STATUS.ISSUED,
      INVOICE_STATUS.PAID,
      INVOICE_STATUS.VOID,
    ]) {
      const { svc, prisma, invoiceUpdate } = makeService();
      prisma.invoice.findFirst.mockResolvedValue({
        id: "inv-1",
        status,
        pdfKey: "frozen.pdf",
        pdfGeneratedAt: new Date(),
        lineItems: [],
        orders: [],
      });
      await expect(
        svc.generateInvoicePdf("t1", "inv-1", { userId: "u1" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(invoiceUpdate).not.toHaveBeenCalled();
    }
  });
});
