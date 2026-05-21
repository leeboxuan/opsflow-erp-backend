import { JobStatus, TripStatus } from "@prisma/client";
import { syncJobInvoiceReadiness } from "./job-invoice-readiness";

function makePrisma(job: any, trips: Array<{ id: string; status: TripStatus }>) {
  const jobUpdate = jest.fn().mockResolvedValue({});
  return {
    prisma: {
      job: {
        findFirst: jest.fn().mockResolvedValue(job),
        update: jobUpdate,
      },
      trip: {
        findMany: jest.fn().mockResolvedValue(trips),
      },
    },
    jobUpdate,
  };
}

describe("syncJobInvoiceReadiness", () => {
  it("LCL job with one COMPLETED trip becomes READY_FOR_INVOICE with invoiceReadyAt", async () => {
    const { prisma, jobUpdate } = makePrisma(
      { id: "job1", status: JobStatus.ONGOING, invoiceReadyAt: null },
      [{ id: "t1", status: TripStatus.COMPLETED }],
    );

    const result = await syncJobInvoiceReadiness(prisma, "t1", "job1");

    expect(result).toMatchObject({
      readyForInvoice: true,
      status: JobStatus.READY_FOR_INVOICE,
      isInvoiceReady: true,
      changed: true,
    });
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job1" },
      data: {
        status: JobStatus.READY_FOR_INVOICE,
        invoiceReadyAt: expect.any(Date),
      },
    });
  });

  it("IMPORT job with COMPLETED and ONGOING trips stays ONGOING", async () => {
    const { prisma, jobUpdate } = makePrisma(
      { id: "job1", status: JobStatus.ONGOING, invoiceReadyAt: null },
      [
        { id: "t1", status: TripStatus.COMPLETED },
        { id: "t2", status: TripStatus.ONGOING },
      ],
    );

    const result = await syncJobInvoiceReadiness(prisma, "t1", "job1");

    expect(result).toMatchObject({
      readyForInvoice: false,
      status: JobStatus.ONGOING,
      isInvoiceReady: false,
    });
    expect(jobUpdate).not.toHaveBeenCalled();
  });

  it("job with only CANCELLED trips is not READY_FOR_INVOICE", async () => {
    const { prisma, jobUpdate } = makePrisma(
      { id: "job1", status: JobStatus.ONGOING, invoiceReadyAt: null },
      [
        { id: "t1", status: TripStatus.CANCELLED },
        { id: "t2", status: TripStatus.CANCELLED },
      ],
    );

    const result = await syncJobInvoiceReadiness(prisma, "t1", "job1");

    expect(result?.readyForInvoice).toBe(false);
    expect(result?.status).toBe(JobStatus.ONGOING);
    expect(jobUpdate).not.toHaveBeenCalled();
  });

  it("READY_FOR_INVOICE job with new DRAFT trip demotes to ONGOING and clears invoiceReadyAt", async () => {
    const priorReadyAt = new Date("2026-05-01T00:00:00.000Z");
    const { prisma, jobUpdate } = makePrisma(
      {
        id: "job1",
        status: JobStatus.READY_FOR_INVOICE,
        invoiceReadyAt: priorReadyAt,
      },
      [
        { id: "t1", status: TripStatus.DONE },
        { id: "t2", status: TripStatus.DRAFT },
      ],
    );

    const result = await syncJobInvoiceReadiness(prisma, "t1", "job1");

    expect(result).toMatchObject({
      readyForInvoice: false,
      status: JobStatus.ONGOING,
      isInvoiceReady: false,
      invoiceReadyAt: null,
      changed: true,
    });
    expect(jobUpdate).toHaveBeenCalledWith({
      where: { id: "job1" },
      data: {
        status: JobStatus.ONGOING,
        invoiceReadyAt: null,
      },
    });
  });

  it("dryRun does not call job.update", async () => {
    const { prisma, jobUpdate } = makePrisma(
      { id: "job1", status: JobStatus.ONGOING, invoiceReadyAt: null },
      [{ id: "t1", status: TripStatus.COMPLETED }],
    );

    const result = await syncJobInvoiceReadiness(prisma, "t1", "job1", {
      dryRun: true,
    });

    expect(result?.changed).toBe(true);
    expect(result?.dryRun).toBe(true);
    expect(result?.status).toBe(JobStatus.READY_FOR_INVOICE);
    expect(jobUpdate).not.toHaveBeenCalled();
  });

  it("preserves invoiceReadyAt when job already ready and trips still complete", async () => {
    const priorReadyAt = new Date("2026-05-01T00:00:00.000Z");
    const { prisma, jobUpdate } = makePrisma(
      {
        id: "job1",
        status: JobStatus.READY_FOR_INVOICE,
        invoiceReadyAt: priorReadyAt,
      },
      [{ id: "t1", status: TripStatus.COMPLETED }],
    );

    const result = await syncJobInvoiceReadiness(prisma, "t1", "job1");

    expect(result).toMatchObject({
      readyForInvoice: true,
      status: JobStatus.READY_FOR_INVOICE,
      invoiceReadyAt: priorReadyAt,
      changed: false,
    });
    expect(jobUpdate).not.toHaveBeenCalled();
  });
});
