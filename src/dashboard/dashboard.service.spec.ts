import { JobStatus } from "@prisma/client";
import { DashboardService } from "./dashboard.service";

describe("DashboardService.getSummary", () => {
  it("returns jobs metrics and mirrors awaitingInvoice to readyForInvoiceNotInvoiced", async () => {
    const prisma: any = {
      job: {
        count: jest
          .fn()
          .mockResolvedValueOnce(8)
          .mockResolvedValueOnce(4),
        groupBy: jest.fn().mockResolvedValue([
          { status: JobStatus.ONGOING, _count: { _all: 3 } },
          { status: JobStatus.READY_FOR_INVOICE, _count: { _all: 2 } },
          { status: JobStatus.COMPLETED, _count: { _all: 2 } },
          { status: JobStatus.CANCELLED, _count: { _all: 1 } },
        ]),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ count: 1n }]),
      transportOrder: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      trip: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jest.fn().mockResolvedValue([]),
      },
      inventory_units: {
        count: jest.fn().mockResolvedValue(0),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      drivers: { count: jest.fn().mockResolvedValue(0) },
      eventLog: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const svc = new DashboardService(prisma);
    const summary = await svc.getSummary("tenant-1");

    expect(summary.jobs).toEqual({
      total: 8,
      ongoing: 3,
      readyForInvoice: 4,
      readyForInvoiceNotInvoiced: 1,
      completed: 2,
      cancelled: 1,
      byStatus: {
        ONGOING: 3,
        READY_FOR_INVOICE: 2,
        COMPLETED: 2,
        CANCELLED: 1,
      },
    });
    expect(summary.orders.awaitingInvoice).toBe(1);
    expect(prisma.job.findMany).toBeUndefined();
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});
