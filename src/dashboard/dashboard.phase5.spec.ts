import { DashboardService } from "./dashboard.service";

describe("DashboardService Phase 5 aggregates", () => {
  it("does not load ready/invoiced job ID arrays for summary metrics", async () => {
    const jobFindMany = jest.fn();
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
      job: {
        count: jest.fn().mockResolvedValue(10),
        groupBy: jest.fn().mockResolvedValue([]),
        findMany: jobFindMany,
      },
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
      $queryRaw: jest.fn((sql: { strings?: string[] }) => {
        const text = String(sql?.strings?.join("") ?? "");
        if (text.includes("COUNT(*)")) {
          return Promise.resolve([{ count: 3n }]);
        }
        return Promise.resolve([]);
      }),
    };

    const svc = new DashboardService(prisma);
    const summary = await svc.getSummary("tenant-a");

    expect(jobFindMany).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).toHaveBeenCalled();
    expect(summary.jobs.readyForInvoiceNotInvoiced).toBe(3);
    expect(summary.kpis.readyToInvoiceNotInvoiced).toBe(3);
    // Every job aggregate path must include tenantId
    expect(prisma.job.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-a" }),
      }),
    );
  });
});
