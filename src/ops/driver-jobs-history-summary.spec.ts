import { TripStatus } from "@prisma/client";
import { DriverJobsService } from "./driver-jobs.service";

describe("DriverJobsService.getHistorySummaryByDriver", () => {
  const tenantId = "tenant-1";
  const driverUserId = "driver-1";

  function makeService(tripRows: Array<{ closedAt: Date | null; updatedAt: Date }>) {
    const prisma: any = {
      tenant: {
        findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
      },
      trip: {
        findMany: jest.fn().mockResolvedValue(tripRows),
      },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    return { svc, prisma };
  }

  it("aggregates completed trips by closedAt month in tenant timezone (May 2026)", async () => {
    const closedAt = new Date("2026-05-15T08:00:00.000Z");
    const { svc, prisma } = makeService([
      { closedAt, updatedAt: new Date("2026-05-16T00:00:00.000Z") },
    ]);

    const res = await svc.getHistorySummaryByDriver(tenantId, driverUserId);

    expect(prisma.trip.findMany).toHaveBeenCalledWith({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
      },
      select: { closedAt: true, updatedAt: true },
    });

    expect(res.years).toHaveLength(1);
    expect(res.years[0].year).toBe(2026);
    expect(res.years[0].total).toBe(1);
    expect(res.years[0].months).toHaveLength(1);
    expect(res.years[0].months[0].month).toBe("2026-05");
    expect(res.years[0].months[0].label).toBe("May 2026");
    expect(res.years[0].months[0].total).toBe(1);
  });

  it("counts a completed trip even when parent job would still be ONGOING (trip-only history)", async () => {
    const { svc } = makeService([
      {
        closedAt: new Date("2026-04-10T00:00:00.000Z"),
        updatedAt: new Date("2026-04-10T01:00:00.000Z"),
      },
    ]);
    const res = await svc.getHistorySummaryByDriver(tenantId, driverUserId);
    expect(res.years[0].total).toBe(1);
  });

  it("scopes query to tenant and assignedDriverUserId (other drivers never queried as current user)", async () => {
    const { svc, prisma } = makeService([]);
    await svc.getHistorySummaryByDriver(tenantId, driverUserId);
    const arg = prisma.trip.findMany.mock.calls[0][0];
    expect(arg.where.tenantId).toBe(tenantId);
    expect(arg.where.assignedDriverUserId).toBe(driverUserId);
    prisma.trip.findMany.mockClear();
    await svc.getHistorySummaryByDriver(tenantId, "driver-2");
    expect(prisma.trip.findMany.mock.calls[0][0].where.assignedDriverUserId).toBe("driver-2");
  });

  it("does not include cancelled, draft, or ongoing trips (status filter on query)", async () => {
    const { svc, prisma } = makeService([]);
    await svc.getHistorySummaryByDriver(tenantId, driverUserId);
    expect(prisma.trip.findMany.mock.calls[0][0].where.status).toEqual({
      in: [TripStatus.COMPLETED, TripStatus.DONE],
    });
  });

  it("uses updatedAt when closedAt is null for COMPLETED/DONE rows", async () => {
    const updatedAt = new Date("2026-03-20T12:00:00.000Z");
    const { svc } = makeService([{ closedAt: null, updatedAt }]);
    const res = await svc.getHistorySummaryByDriver(tenantId, driverUserId);
    expect(res.years[0].months[0].month).toBe("2026-03");
  });

  it("skips rows with neither closedAt nor updatedAt", async () => {
    const { svc } = makeService([{ closedAt: null, updatedAt: null as any }]);
    const res = await svc.getHistorySummaryByDriver(tenantId, driverUserId);
    expect(res.years).toHaveLength(0);
  });

  it("sorts years newest first and months within a year newest first", async () => {
    const { svc } = makeService([
      { closedAt: new Date("2025-06-01T00:00:00.000Z"), updatedAt: new Date("2025-06-01T00:00:00.000Z") },
      { closedAt: new Date("2026-01-05T00:00:00.000Z"), updatedAt: new Date("2026-01-05T00:00:00.000Z") },
      { closedAt: new Date("2026-05-01T00:00:00.000Z"), updatedAt: new Date("2026-05-01T00:00:00.000Z") },
    ]);
    const res = await svc.getHistorySummaryByDriver(tenantId, driverUserId);
    expect(res.years.map((y) => y.year)).toEqual([2026, 2025]);
    const months2026 = res.years[0].months.map((m) => m.month);
    expect(months2026).toEqual(["2026-05", "2026-01"]);
  });

  it("falls back to Asia/Singapore when tenant timezone is missing", async () => {
    const prisma: any = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: null }) },
      trip: {
        findMany: jest.fn().mockResolvedValue([
          { closedAt: new Date("2026-07-01T00:00:00.000Z"), updatedAt: new Date("2026-07-01T00:00:00.000Z") },
        ]),
      },
    };
    const svc = new DriverJobsService(prisma, {} as any, {} as any);
    const res = await svc.getHistorySummaryByDriver(tenantId, driverUserId);
    expect(res.years[0].months[0].month).toBe("2026-07");
  });
});
