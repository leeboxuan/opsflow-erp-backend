import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { JobStatus, TripStatus } from "@prisma/client";
import { DashboardService } from "./dashboard.service";
import { DashboardSummaryQueryDto } from "./dto";
import { INVOICED_INVOICE_STATUSES } from "./dashboard-job-metrics";

function createPrismaMock(overrides: Record<string, unknown> = {}) {
  const jobCount = jest.fn().mockResolvedValue(0);
  const tripCount = jest.fn().mockResolvedValue(0);
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
    },
    job: {
      count: jobCount,
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn(),
    },
    $queryRaw: jest.fn((sql: { strings?: string[] }) => {
      const text = String(sql?.strings?.join("") ?? "");
      if (text.includes("COUNT(*)")) {
        return Promise.resolve([{ count: 0n }]);
      }
      return Promise.resolve([]);
    }),
    transportOrder: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    trip: {
      count: tripCount,
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    inventory_units: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    drivers: { count: jest.fn().mockResolvedValue(0) },
    eventLog: { findMany: jest.fn().mockResolvedValue([{ id: "evt-1" }]) },
    ...overrides,
  };
}

describe("DashboardService KPIs (Phase 1)", () => {
  it("returns additive metadata and kpis while preserving legacy fields including activity", async () => {
    const prisma: any = createPrismaMock();
    prisma.$queryRaw = jest.fn((sql: { strings?: string[] }) => {
      const text = String(sql?.strings?.join("") ?? "");
      if (text.includes("COUNT(*)")) {
        return Promise.resolve([{ count: 2n }]);
      }
      return Promise.resolve([]);
    });
    prisma.job.count
      .mockResolvedValueOnce(8) // total
      .mockResolvedValueOnce(4) // ready broad
      .mockResolvedValueOnce(5); // jobsInPeriod
    prisma.trip.count
      .mockResolvedValueOnce(10) // trip total
      .mockResolvedValueOnce(1) // activeToday legacy
      .mockResolvedValueOnce(3) // tripsInProgress
      .mockResolvedValueOnce(4) // tripsCompletedInPeriod
      .mockResolvedValueOnce(2) // pendingDriverAssignment
      .mockResolvedValueOnce(8) // scheduled
      .mockResolvedValueOnce(6) // completed scheduled
      .mockResolvedValueOnce(0) // unassigned attention
      .mockResolvedValueOnce(0); // overdue attention

    const svc = new DashboardService(prisma);
    const summary = await svc.getSummary("tenant-a", {});

    expect(summary.timeZone).toBe("Asia/Singapore");
    expect(summary.from).toBe(summary.to);
    expect(summary.kpis).toEqual({
      jobsInPeriod: 5,
      tripsInProgress: 3,
      tripsCompletedInPeriod: 4,
      pendingDriverAssignment: 2,
      readyToInvoiceNotInvoiced: 2,
      completionRate: 0.75,
      completionRateBasis: { completed: 6, scheduled: 8 },
    });
    expect(summary.attention).toEqual({
      total: 2,
      counts: { critical: 0, warning: 2, info: 0 },
      items: [],
    });
    expect(summary.jobs.readyForInvoiceNotInvoiced).toBe(2);
    expect(summary.trips.activeToday).toBe(1);
    expect(summary.activity).toEqual([{ id: "evt-1" }]);
    expect(typeof summary.generatedAt).toBe("string");
  });

  it("scopes every KPI count to the requested tenant and excludes cancelled / jobId-null where required", async () => {
    const prisma: any = createPrismaMock();
    const svc = new DashboardService(prisma);
    await svc.getSummary("tenant-a", {
      from: "2026-08-01",
      to: "2026-08-07",
    });

    const jobWheres = prisma.job.count.mock.calls.map(
      (call: any[]) => call[0].where,
    );
    for (const where of jobWheres) {
      expect(where.tenantId).toBe("tenant-a");
    }
    const jobsInPeriodWhere = jobWheres.find(
      (where: any) => where.OR && where.status?.not === JobStatus.CANCELLED,
    );
    expect(jobsInPeriodWhere).toBeDefined();
    expect(jobsInPeriodWhere.tenantId).toBe("tenant-a");

    const tripWheres = prisma.trip.count.mock.calls.map(
      (call: any[]) => call[0].where,
    );
    const inProgress = tripWheres.find(
      (where: any) =>
        Array.isArray(where.status?.in) &&
        where.status.in.includes(TripStatus.ONGOING) &&
        where.jobId?.not === null &&
        !where.closedAt,
    );
    expect(inProgress?.tenantId).toBe("tenant-a");
    expect(inProgress?.jobId).toEqual({ not: null });

    const pending = tripWheres.find(
      (where: any) =>
        where.assignedDriverUserId === null && where.driverId === null,
    );
    expect(pending?.tenantId).toBe("tenant-a");
    expect(pending?.jobId).toEqual({ not: null });
    expect(pending?.status?.notIn).toEqual(
      expect.arrayContaining([
        TripStatus.COMPLETED,
        TripStatus.DONE,
        TripStatus.CANCELLED,
      ]),
    );

    const completedInPeriod = tripWheres.find(
      (where: any) => where.closedAt != null,
    );
    expect(completedInPeriod?.tenantId).toBe("tenant-a");
    expect(completedInPeriod?.jobId).toEqual({ not: null });
  });

  it("never queries Tenant B when summarizing Tenant A", async () => {
    const prisma: any = createPrismaMock();
    const svc = new DashboardService(prisma);
    await svc.getSummary("tenant-a");

    expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
      where: { id: "tenant-a" },
      select: { timezone: true },
    });

    const serialized = JSON.stringify([
      ...prisma.job.count.mock.calls,
      ...prisma.trip.count.mock.calls,
      ...prisma.job.groupBy.mock.calls,
      ...prisma.trip.groupBy.mock.calls,
      ...prisma.eventLog.findMany.mock.calls,
      prisma.$queryRaw.mock.calls,
    ]);
    expect(serialized).not.toContain("tenant-b");
    expect(serialized).toContain("tenant-a");
  });

  it("tripsInProgress query does not include the selected date range", async () => {
    const prisma: any = createPrismaMock();
    const svc = new DashboardService(prisma);
    await svc.getSummary("tenant-a", {
      from: "2026-07-01",
      to: "2026-07-31",
    });

    const inProgressWhere = prisma.trip.count.mock.calls
      .map((call: any[]) => call[0].where)
      .find(
        (where: any) =>
          Array.isArray(where.status?.in) &&
          where.status.in.includes(TripStatus.PUBLISHED) &&
          where.status.in.includes(TripStatus.ONGOING) &&
          where.jobId?.not === null &&
          !where.closedAt &&
          !where.OR,
      );
    expect(inProgressWhere).toBeDefined();
    expect(inProgressWhere.plannedStartAt).toBeUndefined();
    expect(inProgressWhere.createdAt).toBeUndefined();
    expect(inProgressWhere.startedAt).toBeUndefined();
    expect(inProgressWhere.updatedAt).toBeUndefined();
  });

  it("returns null completionRate when scheduled cohort is zero", async () => {
    const prisma: any = createPrismaMock();
    prisma.trip.count.mockResolvedValue(0);
    const svc = new DashboardService(prisma);
    const summary = await svc.getSummary("tenant-a");
    expect(summary.kpis.completionRate).toBeNull();
    expect(summary.kpis.completionRateBasis).toEqual({
      completed: 0,
      scheduled: 0,
    });
  });

  it("ready-to-invoice raw SQL uses ISSUED/PAID and tenantId on jobs and invoices", async () => {
    const prisma: any = createPrismaMock();
    const svc = new DashboardService(prisma);
    await svc.getSummary("tenant-a");

    const countCall = prisma.$queryRaw.mock.calls.find((call: any[]) =>
      String(call[0]?.strings?.join("") ?? "").includes("COUNT(*)"),
    );
    expect(countCall).toBeDefined();
    const sqlArg = countCall[0];
    const sqlText = String(sqlArg?.strings?.join("?") ?? sqlArg);
    const sqlValues = Array.isArray(sqlArg?.values) ? sqlArg.values : [];
    expect(sqlText).toContain('j."tenantId"');
    expect(sqlText).toContain('i."tenantId"');
    expect(sqlText).toContain('::"InvoiceStatus"');
    expect(sqlText.replace(/\s+/g, " ")).toMatch(
      /i\."status" IN \(\?::"InvoiceStatus",\s*\?::"InvoiceStatus"\)/,
    );
    expect(sqlValues).toContain("tenant-a");
    expect(sqlValues).toContain(JobStatus.READY_FOR_INVOICE);
    expect(sqlValues).toEqual(
      expect.arrayContaining([...INVOICED_INVOICE_STATUSES]),
    );
    expect([...INVOICED_INVOICE_STATUSES]).toEqual(["ISSUED", "PAID"]);
    expect([...INVOICED_INVOICE_STATUSES]).not.toContain("Draft");
    expect([...INVOICED_INVOICE_STATUSES]).not.toContain("Void");
    expect([...INVOICED_INVOICE_STATUSES]).not.toContain("GENERATED");
  });

  it("rejects service calls with only one date bound", async () => {
    const prisma: any = createPrismaMock();
    const svc = new DashboardService(prisma);
    await expect(
      svc.getSummary("tenant-a", { from: "2026-08-01" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("DashboardSummaryQueryDto validation", () => {
  const pipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  async function transform(query: Record<string, unknown>) {
    return pipe.transform(query, {
      type: "query",
      metatype: DashboardSummaryQueryDto,
    });
  }

  it("accepts both omitted and both provided", async () => {
    await expect(transform({})).resolves.toEqual({});
    await expect(
      transform({ from: "2026-08-01", to: "2026-08-07" }),
    ).resolves.toMatchObject({ from: "2026-08-01", to: "2026-08-07" });
  });

  it("rejects only one of from/to, invalid dates, and reversed ranges", async () => {
    await expect(transform({ from: "2026-08-01" })).rejects.toBeTruthy();
    await expect(transform({ to: "2026-08-01" })).rejects.toBeTruthy();
    await expect(
      transform({ from: "2026-02-30", to: "2026-03-01" }),
    ).rejects.toBeTruthy();
    await expect(
      transform({ from: "2026-08-07", to: "2026-08-01" }),
    ).rejects.toBeTruthy();
  });
});
