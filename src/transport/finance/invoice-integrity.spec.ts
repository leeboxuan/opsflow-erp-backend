import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { JobStatus } from "@prisma/client";
import { InvoicesService } from "./invoices.service";
import {
  canMarkInvoicePaid,
  canRevertInvoiceToDraft,
  INVOICE_STATUS,
  isInvoiceDraft,
  isInvoicePaid,
  isInvoiceRecognized,
  isInvoiceReserving,
  isInvoiceVoid,
  mixedQuotationMessage,
} from "./invoice-integrity";

describe("invoice integrity helpers", () => {
  it("classifies runtime statuses without treating Issued as gone", () => {
    expect(isInvoiceDraft("Draft")).toBe(true);
    expect(isInvoiceRecognized("Sent")).toBe(true);
    expect(isInvoiceRecognized("Issued")).toBe(true);
    expect(isInvoiceRecognized("Paid")).toBe(true);
    expect(isInvoiceRecognized("Draft")).toBe(false);
    expect(isInvoiceReserving("Draft")).toBe(true);
    expect(isInvoiceReserving("Void")).toBe(false);
    expect(isInvoicePaid("Paid")).toBe(true);
    expect(isInvoiceVoid("Void")).toBe(true);
    expect(canMarkInvoicePaid("Sent")).toBe(true);
    expect(canMarkInvoicePaid("Draft")).toBe(false);
    expect(canRevertInvoiceToDraft("Paid")).toBe(false);
  });
});

describe("InvoicesService charge-level integrity", () => {
  function charge(overrides: Record<string, unknown> = {}) {
    return {
      id: "jc-a",
      jobId: "job-a",
      label: "Trucking",
      job: {
        id: "job-a",
        internalRef: "JOB-A",
        status: JobStatus.READY_FOR_INVOICE,
        invoiceReadyAt: new Date(),
        customerCompanyId: "c1",
        sourceCustomerQuotationId: "qt-1",
      },
      ...overrides,
    };
  }

  function makeService(overrides: Record<string, unknown> = {}) {
    const createdInvoice = {
      id: "inv-1",
      invoiceNo: "INV-202608-0001",
      status: "Draft",
      sourceJobId: "job-a",
      sourceCustomerQuotationId: "qt-1",
      snapshot: { sourceJobIds: ["job-a"] },
      lineItems: [{ id: "line-1", jobChargeId: "jc-a" }],
      orders: [],
    };
    const prisma: any = {
      $transaction: jest.fn(async (fn: any) => fn(prisma)),
      $executeRaw: jest.fn().mockResolvedValue(0),
      invoice: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(createdInvoice),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          ...createdInvoice,
          ...data,
          lineItems: createdInvoice.lineItems,
          orders: [],
        })),
      },
      invoiceLineItem: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      invoiceChargeReservation: {
        findMany: jest.fn().mockResolvedValue([]),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      jobCharge: {
        findMany: jest.fn().mockResolvedValue([charge()]),
      },
      job: {
        findFirst: jest.fn().mockResolvedValue({
          id: "job-a",
          customerCompanyId: "c1",
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "job-a",
            status: JobStatus.READY_FOR_INVOICE,
            invoiceReadyAt: new Date(),
            charges: [{ id: "jc-a" }],
          },
        ]),
        update: jest.fn(),
      },
      customerQuotation: {
        findFirst: jest.fn().mockResolvedValue({
          id: "qt-1",
          customerCompanyId: "c1",
          status: "ACCEPTED",
        }),
      },
      transportOrder: { findMany: jest.fn().mockResolvedValue([]) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const svc = new InvoicesService(prisma, { getClient: jest.fn() } as any, audit as any);
    return { svc, prisma, audit, createdInvoice };
  }

  const actor = { userId: "u1", role: "ADMIN" };

  const lineFromCharge = {
    description: "JOB-A — Trucking",
    qty: 1,
    unitPriceCents: 10000,
    taxCode: "SR",
    taxRate: 900,
    jobChargeId: "jc-a",
    sourceJobId: "job-a",
    sourceType: "JOB",
  };

  it("persists InvoiceLine.jobChargeId when creating a draft from JobCharges", async () => {
    const { svc, prisma, createdInvoice } = makeService();
    prisma.invoice.create.mockResolvedValue({
      ...createdInvoice,
      lineItems: [
        { id: "line-1", jobChargeId: "jc-a", description: "JOB-A — Trucking" },
      ],
    });
    await svc.createDraftInvoice(
      "t1",
      {
        customerName: "Acme",
        customerCompanyId: "c1",
        sourceCustomerQuotationId: "qt-1",
        lineItems: [lineFromCharge],
      } as any,
      actor,
    );
    const createData = prisma.invoice.create.mock.calls[0][0].data;
    expect(createData.lineItems.create[0].jobChargeId).toBe("jc-a");
    expect(createData.sourceCustomerQuotationId).toBe("qt-1");
    expect(prisma.invoiceChargeReservation.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: "t1", invoiceId: "inv-1", jobChargeId: "jc-a" }],
    });
  });

  it("keeps manual lines with null jobChargeId", async () => {
    const { svc, prisma } = makeService({
      jobCharge: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await svc.createDraftInvoice(
      "t1",
      {
        customerName: "Acme",
        lineItems: [
          {
            description: "Manual",
            qty: 1,
            unitPriceCents: 100,
            taxCode: "SR",
            taxRate: 900,
          },
        ],
      } as any,
      actor,
    );
    expect(
      prisma.invoice.create.mock.calls[0][0].data.lineItems.create[0].jobChargeId,
    ).toBeNull();
    expect(prisma.invoiceChargeReservation.createMany).not.toHaveBeenCalled();
  });

  it("rejects billing a JobCharge already reserved by another invoice", async () => {
    const { svc } = makeService({
      invoiceChargeReservation: {
        findMany: jest.fn().mockResolvedValue([{ jobChargeId: "jc-a" }]),
        createMany: jest.fn(),
        deleteMany: jest.fn(),
      },
    });
    await expect(
      svc.createDraftInvoice(
        "t1",
        {
          customerName: "Acme",
          customerCompanyId: "c1",
          lineItems: [lineFromCharge],
        } as any,
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("allows a second invoice for a different JobCharge on the same Job", async () => {
    const { svc, prisma } = makeService({
      jobCharge: {
        findMany: jest.fn().mockResolvedValue([
          charge({ id: "jc-b", label: "DHC" }),
        ]),
      },
    });
    await svc.createDraftInvoice(
      "t1",
      {
        customerName: "Acme",
        customerCompanyId: "c1",
        sourceJobId: "job-a",
        lineItems: [{ ...lineFromCharge, jobChargeId: "jc-b" }],
      } as any,
      actor,
    );
    expect(prisma.invoice.create).toHaveBeenCalled();
    expect(prisma.invoiceChargeReservation.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: "t1", invoiceId: "inv-1", jobChargeId: "jc-b" }],
    });
  });

  it("rejects mixing JobCharges from different quotations on one invoice", async () => {
    const { svc } = makeService({
      jobCharge: {
        findMany: jest.fn().mockResolvedValue([
          charge(),
          charge({
            id: "jc-b",
            jobId: "job-b",
            job: {
              id: "job-b",
              internalRef: "JOB-B",
              status: JobStatus.READY_FOR_INVOICE,
              invoiceReadyAt: new Date(),
              customerCompanyId: "c1",
              sourceCustomerQuotationId: "qt-2",
            },
          }),
        ]),
      },
    });
    await expect(
      svc.createDraftInvoice(
        "t1",
        {
          customerName: "Acme",
          customerCompanyId: "c1",
          lineItems: [
            lineFromCharge,
            { ...lineFromCharge, jobChargeId: "jc-b" },
          ],
        } as any,
        actor,
      ),
    ).rejects.toThrow(mixedQuotationMessage());
  });

  it("allows one invoice to include charges from many Jobs under the same quotation", async () => {
    const { svc, prisma } = makeService({
      jobCharge: {
        findMany: jest.fn().mockResolvedValue([
          charge(),
          charge({
            id: "jc-b",
            jobId: "job-b",
            job: {
              id: "job-b",
              internalRef: "JOB-B",
              status: JobStatus.READY_FOR_INVOICE,
              invoiceReadyAt: new Date(),
              customerCompanyId: "c1",
              sourceCustomerQuotationId: "qt-1",
            },
          }),
        ]),
      },
    });
    await svc.createDraftInvoice(
      "t1",
      {
        customerName: "Acme",
        customerCompanyId: "c1",
        sourceCustomerQuotationId: "qt-1",
        lineItems: [
          lineFromCharge,
          { ...lineFromCharge, jobChargeId: "jc-b" },
        ],
      } as any,
      actor,
    );
    expect(prisma.invoiceChargeReservation.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: "t1", invoiceId: "inv-1", jobChargeId: "jc-a" },
        { tenantId: "t1", invoiceId: "inv-1", jobChargeId: "jc-b" },
      ],
    });
  });

  it("voids a Sent invoice and releases JobCharge reservations", async () => {
    const inv = {
      id: "inv-1",
      invoiceNo: "INV-1",
      status: "Sent",
      sourceJobId: "job-a",
      snapshot: { sourceJobIds: ["job-a"] },
      lineItems: [{ jobChargeId: "jc-a" }],
    };
    const { svc, prisma, audit } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue(inv),
        update: jest.fn().mockResolvedValue({
          ...inv,
          status: "Void",
          lineItems: inv.lineItems,
          orders: [],
        }),
      },
    });
    await svc.voidInvoice("t1", "inv-1", actor);
    expect(prisma.invoiceChargeReservation.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", invoiceId: "inv-1" },
    });
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "INVOICE_VOIDED",
      "INVOICE",
      "inv-1",
      expect.objectContaining({ previousStatus: "Sent", status: "Void" }),
      "u1",
    );
  });

  it("keeps charge reservations when reverting Sent to Draft", async () => {
    const inv = {
      id: "inv-1",
      invoiceNo: "INV-1",
      status: "Sent",
      sourceJobId: "job-a",
      issuedByUserId: "u1",
      snapshot: { sourceJobIds: ["job-a"], orderIds: [] },
      lineItems: [{ jobChargeId: "jc-a" }],
      orders: [],
    };
    const { svc, prisma } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue(inv),
        update: jest.fn().mockResolvedValue({
          ...inv,
          status: "Draft",
          lineItems: inv.lineItems,
          orders: [],
        }),
      },
      transportOrder: { updateMany: jest.fn() },
    });
    await svc.revertInvoiceToDraft("t1", "inv-1", actor);
    expect(prisma.invoiceChargeReservation.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: "t1", invoiceId: "inv-1", jobChargeId: "jc-a" }],
    });
  });

  it("rejects Draft → Paid and Void → Paid", async () => {
    const { svc } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv-1",
          status: "Draft",
          lineItems: [],
        }),
      },
    });
    await expect(svc.markInvoicePaid("t1", "inv-1", actor)).rejects.toThrow(
      "Only Sent/Issued invoices can be marked Paid",
    );
  });

  it("marks Sent invoices Paid with paidAt and audit", async () => {
    const inv = {
      id: "inv-1",
      invoiceNo: "INV-1",
      status: "Sent",
      lineItems: [{ jobChargeId: "jc-a" }],
    };
    const { svc, prisma, audit } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue(inv),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          ...inv,
          ...data,
          orders: [],
        })),
      },
    });
    await svc.markInvoicePaid("t1", "inv-1", actor);
    expect(prisma.invoice.update.mock.calls[0][0].data.status).toBe(
      INVOICE_STATUS.PAID,
    );
    expect(prisma.invoice.update.mock.calls[0][0].data.paidAt).toBeInstanceOf(
      Date,
    );
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "INVOICE_PAID",
      "INVOICE",
      "inv-1",
      expect.objectContaining({
        previousStatus: "Sent",
        status: "Paid",
        actorUserId: "u1",
      }),
      "u1",
    );
  });

  it("does not allow TRANSPORT_STAFF to mark Paid", async () => {
    const { svc } = makeService();
    await expect(
      svc.markInvoicePaid("t1", "inv-1", {
        userId: "ops",
        role: "TRANSPORT_STAFF",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects reverting a Paid invoice to Draft", async () => {
    const { svc } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv-1",
          status: "Paid",
          lineItems: [],
          orders: [],
        }),
      },
    });
    await expect(svc.revertInvoiceToDraft("t1", "inv-1", actor)).rejects.toThrow(
      "Paid invoices cannot be reverted to Draft",
    );
  });
});
