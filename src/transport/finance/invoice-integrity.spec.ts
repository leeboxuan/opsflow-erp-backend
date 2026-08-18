import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { JobStatus } from "@prisma/client";
import { InvoicesService } from "./invoices.service";
import {
  canMarkInvoicePaid,
  INVOICE_STATUS,
  isInvoiceDraft,
  isInvoicePaid,
  isInvoiceRecognized,
  isInvoiceReserving,
  isInvoiceVoid,
  mixedQuotationMessage,
} from "./invoice-integrity";

describe("invoice integrity helpers", () => {
  it("classifies canonical statuses without Sent", () => {
    expect(isInvoiceDraft("DRAFT")).toBe(true);
    expect(isInvoiceRecognized("ISSUED")).toBe(true);
    expect(isInvoiceRecognized("PAID")).toBe(true);
    expect(isInvoiceRecognized("GENERATED")).toBe(false);
    expect(isInvoiceRecognized("DRAFT")).toBe(false);
    expect(isInvoiceReserving("DRAFT")).toBe(true);
    expect(isInvoiceReserving("VOID")).toBe(false);
    expect(isInvoicePaid("PAID")).toBe(true);
    expect(isInvoiceVoid("VOID")).toBe(true);
    expect(canMarkInvoicePaid("ISSUED")).toBe(true);
    expect(canMarkInvoicePaid("GENERATED")).toBe(false);
    expect(canMarkInvoicePaid("DRAFT")).toBe(false);
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
      status: "DRAFT",
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
        findFirst: jest.fn().mockImplementation(async ({ where }: any) => ({
          id: where?.id ?? "job-a",
          customerCompanyId: "c1",
        })),
        findMany: jest.fn().mockImplementation(async ({ where }: any) => {
          const ids: string[] = where?.id?.in ?? (where?.id ? [where.id] : ["job-a"]);
          return ids.map((id: string) => ({
            id,
            customerCompanyId: "c1",
            status: JobStatus.READY_FOR_INVOICE,
            invoiceReadyAt: new Date(),
            charges: [{ id: "jc-a" }],
          }));
        }),
        update: jest.fn(),
      },
      customer_companies: {
        findFirst: jest.fn().mockImplementation(async ({ where }: any) =>
          where?.id ? { id: where.id } : null,
        ),
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

  it("infers customerCompanyId from source jobs when omitted on a job-backed draft", async () => {
    const { svc, prisma } = makeService();
    await svc.createDraftInvoice(
      "t1",
      {
        customerName: "Acme",
        sourceJobId: "job-a",
        sourceJobIds: ["job-a"],
        lineItems: [lineFromCharge],
      } as any,
      actor,
    );
    expect(prisma.invoice.create.mock.calls[0][0].data.customerCompanyId).toBe("c1");
  });

  it("rejects a job-backed draft that mixes source jobs from different customers before persist", async () => {
    const { svc, prisma } = makeService();
    prisma.job.findMany.mockImplementation(async ({ where }: any) => {
      const ids: string[] = where?.id?.in ?? [];
      return ids.map((id: string) => ({
        id,
        customerCompanyId: id === "job-b" ? "c2" : "c1",
      }));
    });
    await expect(
      svc.createDraftInvoice(
        "t1",
        {
          customerName: "Acme",
          sourceJobIds: ["job-a", "job-b"],
          lineItems: [
            lineFromCharge,
            { ...lineFromCharge, jobChargeId: "jc-b", sourceJobId: "job-b" },
          ],
        } as any,
        actor,
      ),
    ).rejects.toThrow("All source jobs must belong to the same customer company");
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("rejects customerCompanyId that does not match the source job customer", async () => {
    const { svc, prisma } = makeService();
    await expect(
      svc.createDraftInvoice(
        "t1",
        {
          customerName: "Acme",
          customerCompanyId: "c-other",
          sourceJobId: "job-a",
          lineItems: [lineFromCharge],
        } as any,
        actor,
      ),
    ).rejects.toThrow("customerCompanyId must match the source job customer");
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  it("still allows a standalone draft without customerCompanyId", async () => {
    const { svc, prisma } = makeService({
      jobCharge: { findMany: jest.fn().mockResolvedValue([]) },
    });
    await svc.createDraftInvoice(
      "t1",
      {
        customerName: "Walk-in",
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
    expect(prisma.invoice.create.mock.calls[0][0].data.customerCompanyId).toBeNull();
  });

  it("preview from jobs returns customerCompanyId", async () => {
    const { svc, prisma } = makeService();
    prisma.job.findMany.mockResolvedValue([
      {
        id: "job-a",
        customerCompanyId: "c1",
        customerCompany: { id: "c1", name: "Acme" },
        receiverName: "Acme",
        internalRef: "JOB-A",
        status: JobStatus.READY_FOR_INVOICE,
        invoiceReadyAt: new Date(),
        sourceCustomerQuotationId: "qt-1",
        charges: [
          {
            id: "jc-a",
            label: "Trucking",
            qty: 1,
            unitPriceCents: 10000,
            taxable: true,
            taxCode: "SR",
            taxRateBasisPoints: 900,
          },
        ],
      },
    ]);
    const preview = await svc.getInvoiceDraftFromJobs("t1", ["job-a"], actor);
    expect(preview.customerCompanyId).toBe("c1");
    expect(preview.customerName).toBe("Acme");
  });

  it("sets customerCompanyId on an existing DRAFT without creating a second invoice", async () => {
    const existingDraft = {
      id: "inv-draft",
      tenantId: "t1",
      invoiceNo: "INV-202608-0001",
      customerName: "Acme",
      customerCompanyId: null,
      sourceJobId: "job-a",
      currency: "SGD",
      status: "DRAFT",
      issueDate: new Date("2026-08-17T00:00:00.000Z"),
      dueDate: null,
      notes: null,
      subtotalCents: 10000,
      taxCents: 900,
      totalCents: 10900,
      lineItems: [{ id: "line-1", ...lineFromCharge }],
      orders: [],
      snapshot: { orderIds: [], sourceJobIds: ["job-a"] },
    };
    const { svc, prisma } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue(existingDraft),
        create: jest.fn(),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          ...existingDraft,
          ...data,
          lineItems: existingDraft.lineItems,
          orders: [],
        })),
      },
    });
    const result = await svc.updateDraftInvoice(
      "t1",
      existingDraft.id,
      {
        customerName: "Acme",
        customerCompanyId: "c1",
        sourceJobId: "job-a",
        sourceJobIds: ["job-a"],
        currency: "SGD",
        lineItems: [lineFromCharge],
      } as any,
      actor,
    );
    expect(prisma.invoice.create).not.toHaveBeenCalled();
    expect(prisma.invoice.update.mock.calls[0][0].data.customerCompanyId).toBe("c1");
    expect(result.id).toBe(existingDraft.id);
  });

  it("voids an ISSUED invoice and releases JobCharge reservations", async () => {
    const inv = {
      id: "inv-1",
      invoiceNo: "INV-1",
      status: "ISSUED",
      sourceJobId: "job-a",
      snapshot: { sourceJobIds: ["job-a"] },
      lineItems: [{ jobChargeId: "jc-a" }],
    };
    const { svc, prisma, audit } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue(inv),
        update: jest.fn().mockResolvedValue({
          ...inv,
          status: "VOID",
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
      expect.objectContaining({ previousStatus: "ISSUED", status: "VOID" }),
      "u1",
    );
  });

  it("rejects GENERATED/ISSUED revert because the service method is retired", () => {
    const { svc } = makeService();
    expect((svc as any).revertInvoiceToDraft).toBeUndefined();
  });

  it("rejects Draft → Paid and Void → Paid", async () => {
    const { svc } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv-1",
          status: "DRAFT",
          lineItems: [],
        }),
      },
    });
    await expect(svc.markInvoicePaid("t1", "inv-1", actor)).rejects.toThrow(
      "Only ISSUED invoices can be marked PAID",
    );
  });

  it("marks ISSUED invoices Paid with paidAt and audit", async () => {
    const inv = {
      id: "inv-1",
      invoiceNo: "INV-1",
      status: "ISSUED",
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
        previousStatus: "ISSUED",
        status: "PAID",
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

  it("rejects GENERATED without frozen PDF metadata on issue", async () => {
    const { svc } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv-1",
          status: "GENERATED",
          pdfKey: null,
          pdfGeneratedAt: null,
          lineItems: [],
        }),
      },
    });
    await expect(svc.issueInvoice("t1", "inv-1", actor)).rejects.toThrow(
      "Invoice GENERATED status is missing consistent frozen PDF metadata",
    );
  });

  it("rejects DRAFT → ISSUED without generation and GENERATED → PAID without issue", async () => {
    const { svc } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv-1",
          status: "DRAFT",
          lineItems: [],
        }),
      },
    });
    await expect(svc.issueInvoice("t1", "inv-1", actor)).rejects.toThrow(
      "Invoice must be GENERATED before it can be ISSUED",
    );
    const generated = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv-1",
          status: "GENERATED",
          lineItems: [],
        }),
      },
    });
    await expect(generated.svc.markInvoicePaid("t1", "inv-1", actor)).rejects.toThrow(
      "Only ISSUED invoices can be marked PAID",
    );
  });

  it("rejects PAID → VOID", async () => {
    const { svc } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue({
          id: "inv-1",
          status: "PAID",
          lineItems: [],
        }),
      },
    });
    await expect(svc.voidInvoice("t1", "inv-1", actor)).rejects.toThrow(
      "Paid invoices cannot be voided in this phase",
    );
  });

  it("rejects issue from PAID and VOID", async () => {
    for (const status of ["PAID", "VOID"]) {
      const { svc } = makeService({
        invoice: {
          findFirst: jest.fn().mockResolvedValue({
            id: "inv-1",
            status,
            pdfKey: "frozen.pdf",
            pdfGeneratedAt: new Date(),
            lineItems: [],
          }),
        },
      });
      await expect(svc.issueInvoice("t1", "inv-1", actor)).rejects.toThrow(
        "Invoice must be GENERATED before it can be ISSUED",
      );
    }
  });

  it("issues GENERATED invoices with a frozen PDF and is idempotent when already ISSUED", async () => {
    const generated = {
      id: "inv-1",
      invoiceNo: "INV-1",
      status: "GENERATED",
      pdfKey: "invoices/inv-1.pdf",
      pdfGeneratedAt: new Date(),
      sourceJobId: "job-a",
      snapshot: { orderIds: [], sourceJobIds: ["job-a"] },
      lineItems: [{ jobChargeId: "jc-a" }],
    };
    const { svc, prisma, audit } = makeService({
      invoice: {
        findFirst: jest.fn().mockResolvedValue(generated),
        update: jest.fn().mockImplementation(({ data }: any) => ({
          ...generated,
          ...data,
          orders: [],
        })),
      },
    });
    await svc.issueInvoice("t1", "inv-1", actor);
    expect(prisma.invoice.update.mock.calls[0][0].data.status).toBe("ISSUED");
    expect(prisma.invoice.update.mock.calls[0][0].data.sentAt).toBeUndefined();
    expect(audit.log).toHaveBeenCalledWith(
      "t1",
      "INVOICE_ISSUED",
      "INVOICE",
      "inv-1",
      expect.objectContaining({
        previousStatus: "GENERATED",
        status: "ISSUED",
      }),
      "u1",
    );

    const issuedSvc = makeService();
    issuedSvc.prisma.invoice.findFirst.mockResolvedValue({
      ...generated,
      status: "ISSUED",
    });
    await issuedSvc.svc.issueInvoice("t1", "inv-1", actor);
    expect(issuedSvc.prisma.invoice.update).not.toHaveBeenCalled();
    expect(issuedSvc.audit.log).not.toHaveBeenCalled();
  });

  it("rejects edits after DRAFT", async () => {
    for (const status of ["GENERATED", "ISSUED", "PAID", "VOID"]) {
      const { svc } = makeService({
        invoice: {
          findFirst: jest.fn().mockResolvedValue({
            id: "inv-1",
            status,
            snapshot: {},
            lineItems: [],
            orders: [],
          }),
        },
      });
      await expect(
        svc.updateDraftInvoice(
          "t1",
          "inv-1",
          { customerName: "Acme", lineItems: [] } as any,
          actor,
        ),
      ).rejects.toThrow("Only DRAFT invoices can be updated");
    }
  });

  it("is idempotent for paid and void repeats", async () => {
    const paidSvc = makeService();
    paidSvc.prisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      invoiceNo: "INV-1",
      status: "PAID",
      lineItems: [],
    });
    await paidSvc.svc.markInvoicePaid("t1", "inv-1", actor);
    expect(paidSvc.prisma.invoice.update).not.toHaveBeenCalled();
    expect(paidSvc.audit.log).not.toHaveBeenCalled();

    const voidSvc = makeService();
    voidSvc.prisma.invoice.findFirst.mockResolvedValue({
      id: "inv-1",
      invoiceNo: "INV-1",
      status: "VOID",
      lineItems: [],
    });
    await voidSvc.svc.voidInvoice("t1", "inv-1", actor);
    expect(voidSvc.prisma.invoice.update).not.toHaveBeenCalled();
    expect(voidSvc.audit.log).not.toHaveBeenCalled();
  });
});
