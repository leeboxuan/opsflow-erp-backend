import { TripStatus } from "@prisma/client";
import { DashboardService } from "./dashboard.service";
import {
  DASHBOARD_ATTENTION_ITEM_LIMIT,
  buildOverdueActiveTripWhere,
  buildUnassignedStartingSoonWhere,
} from "./dashboard-attention";
import { INVOICED_INVOICE_STATUSES } from "./dashboard-job-metrics";

function createPrismaMock(overrides: Record<string, unknown> = {}) {
  const jobCount = jest.fn().mockResolvedValue(0);
  const tripCount = jest.fn().mockResolvedValue(0);
  const tripFindMany = jest.fn().mockResolvedValue([]);
  const queryRaw = jest.fn((sql: { strings?: string[] }) => {
    const text = String(sql?.strings?.join("") ?? "");
    if (text.includes("COUNT(*)")) {
      return Promise.resolve([{ count: 0n }]);
    }
    return Promise.resolve([]);
  });

  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore" }),
    },
    job: {
      count: jobCount,
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn(),
    },
    $queryRaw: queryRaw,
    transportOrder: {
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    trip: {
      count: tripCount,
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: tripFindMany,
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

describe("DashboardService Attention (Phase 2)", () => {
  it("returns additive attention snapshot using shared request clock and Phase 1 ready count", async () => {
    const fixedNow = new Date("2026-08-11T12:00:00.000Z");
    jest.useFakeTimers();
    jest.setSystemTime(fixedNow);

    const prisma: any = createPrismaMock();
    prisma.$queryRaw = jest.fn((sql: { strings?: string[] }) => {
      const text = String(sql?.strings?.join("") ?? "");
      if (text.includes("COUNT(*)")) {
        return Promise.resolve([{ count: 3n }]);
      }
      return Promise.resolve([
        {
          id: "job-ready",
          invoiceReadyAt: new Date("2026-08-01T00:00:00.000Z"),
          updatedAt: new Date("2026-08-02T00:00:00.000Z"),
        },
      ]);
    });

    prisma.trip.findMany.mockImplementation((args: any) => {
      if (args.select?.driverId) return Promise.resolve([]);
      if (args.where?.plannedStartAt) {
        return Promise.resolve([
          {
            id: "trip-soon",
            jobId: "job-soon",
            plannedStartAt: new Date("2026-08-11T15:00:00.000Z"),
          },
        ]);
      }
      if (args.where?.plannedEndAt) {
        return Promise.resolve([
          {
            id: "trip-overdue",
            jobId: "job-overdue",
            plannedEndAt: new Date("2026-08-10T09:00:00.000Z"),
          },
        ]);
      }
      return Promise.resolve([]);
    });

    prisma.trip.count.mockImplementation((args: any) => {
      if (args.where?.plannedStartAt) return Promise.resolve(4);
      if (args.where?.plannedEndAt?.lt) return Promise.resolve(5);
      return Promise.resolve(0);
    });

    const svc = new DashboardService(prisma);
    const summary = await svc.getSummary("tenant-a", {
      from: "2026-07-01",
      to: "2026-07-31",
    });

    expect(summary.generatedAt).toBe(fixedNow.toISOString());
    expect(summary.kpis.readyToInvoiceNotInvoiced).toBe(3);
    expect(summary.attention).toEqual({
      total: 12,
      counts: { critical: 9, warning: 3, info: 0 },
      items: [
        {
          id: "overdue_active_trip:trip-overdue",
          type: "overdue_active_trip",
          severity: "critical",
          entityType: "TRIP",
          entityId: "trip-overdue",
          title: "Overdue active trip",
          reason: "Active trip is past its planned end time.",
          occurredAt: "2026-08-10T09:00:00.000Z",
          dueAt: "2026-08-10T09:00:00.000Z",
          href: "/jobs/job-overdue/workspace?tripId=trip-overdue",
        },
        {
          id: "unassigned_starting_soon:trip-soon",
          type: "unassigned_starting_soon",
          severity: "critical",
          entityType: "TRIP",
          entityId: "trip-soon",
          title: "Unassigned trip starting soon",
          reason:
            "No driver is assigned and the trip starts within 24 hours.",
          occurredAt: "2026-08-11T15:00:00.000Z",
          dueAt: "2026-08-11T15:00:00.000Z",
          href: "/jobs/job-soon/workspace?tripId=trip-soon",
        },
        {
          id: "ready_not_invoiced:job-ready",
          type: "ready_not_invoiced",
          severity: "warning",
          entityType: "JOB",
          entityId: "job-ready",
          title: "Ready to invoice",
          reason:
            "Job is ready for invoice but has no Sent, Issued, or Paid invoice.",
          occurredAt: "2026-08-01T00:00:00.000Z",
          dueAt: null,
          href: "/invoices/create?jobId=job-ready",
        },
      ],
    });

    const unassignedWhere = buildUnassignedStartingSoonWhere(
      "tenant-a",
      fixedNow,
    );
    const overdueWhere = buildOverdueActiveTripWhere("tenant-a", fixedNow);
    expect(prisma.trip.count).toHaveBeenCalledWith({ where: unassignedWhere });
    expect(prisma.trip.count).toHaveBeenCalledWith({ where: overdueWhere });
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: unassignedWhere,
        take: DASHBOARD_ATTENTION_ITEM_LIMIT,
        orderBy: [{ plannedStartAt: "asc" }, { id: "asc" }],
      }),
    );
    expect(prisma.trip.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: overdueWhere,
        take: DASHBOARD_ATTENTION_ITEM_LIMIT,
        orderBy: [{ plannedEndAt: "asc" }, { id: "asc" }],
      }),
    );

    // Attention predicates ignore the selected historical from/to range.
    expect(unassignedWhere.plannedStartAt).toEqual({
      gte: fixedNow,
      lt: new Date("2026-08-12T12:00:00.000Z"),
    });
    expect(summary.from).toBe("2026-07-01");
    expect(summary.to).toBe("2026-07-31");

    jest.useRealTimers();
  });

  it("scopes attention trip queries to tenant and required statuses", async () => {
    const prisma: any = createPrismaMock();
    const svc = new DashboardService(prisma);
    await svc.getSummary("tenant-a");

    const unassignedCalls = prisma.trip.findMany.mock.calls
      .map((call: any[]) => call[0])
      .filter((args: any) => args.where?.plannedStartAt);
    expect(unassignedCalls[0].where).toMatchObject({
      tenantId: "tenant-a",
      jobId: { not: null },
      status: { in: [TripStatus.DRAFT, TripStatus.PUBLISHED] },
      assignedDriverUserId: null,
      driverId: null,
    });
    expect(unassignedCalls[0].where.status.in).not.toContain(TripStatus.ONGOING);
    expect(unassignedCalls[0].where.status.in).not.toContain(
      TripStatus.COMPLETED,
    );

    const overdueCalls = prisma.trip.findMany.mock.calls
      .map((call: any[]) => call[0])
      .filter((args: any) => args.where?.plannedEndAt);
    expect(overdueCalls[0].where).toMatchObject({
      tenantId: "tenant-a",
      jobId: { not: null },
      status: { in: [TripStatus.PUBLISHED, TripStatus.ONGOING] },
      plannedEndAt: expect.objectContaining({ not: null }),
    });

    const serialized = JSON.stringify([
      ...prisma.trip.count.mock.calls,
      ...prisma.trip.findMany.mock.calls,
      ...prisma.$queryRaw.mock.calls,
    ]);
    expect(serialized).toContain("tenant-a");
    expect(serialized).not.toContain("tenant-b");
  });

  it("reuses one ready-not-invoiced count for kpis and attention warning total", async () => {
    const prisma: any = createPrismaMock();
    prisma.$queryRaw = jest.fn((sql: { strings?: string[] }) => {
      const text = String(sql?.strings?.join("") ?? "");
      if (text.includes("COUNT(*)")) {
        return Promise.resolve([{ count: 7n }]);
      }
      return Promise.resolve([]);
    });
    const svc = new DashboardService(prisma);
    const summary = await svc.getSummary("tenant-a");
    expect(summary.kpis.readyToInvoiceNotInvoiced).toBe(7);
    expect(summary.attention.counts.warning).toBe(7);
    expect(summary.attention.total).toBe(7);
    const countCalls = prisma.$queryRaw.mock.calls.filter((call: any[]) =>
      String(call[0]?.strings?.join("") ?? "").includes("COUNT(*)"),
    );
    expect(countCalls).toHaveLength(1);
    const listCalls = prisma.$queryRaw.mock.calls.filter((call: any[]) =>
      String(call[0]?.strings?.join("") ?? "").includes('j."invoiceReadyAt"'),
    );
    expect(listCalls).toHaveLength(1);
    expect([...INVOICED_INVOICE_STATUSES]).toEqual(["Sent", "Issued", "Paid"]);
  });

  it("keeps exact totals when returned items are capped", async () => {
    const prisma: any = createPrismaMock();
    prisma.trip.count.mockImplementation((args: any) => {
      if (args.where?.plannedStartAt) return Promise.resolve(20);
      if (args.where?.plannedEndAt?.lt) return Promise.resolve(20);
      return Promise.resolve(0);
    });
    prisma.$queryRaw = jest.fn((sql: { strings?: string[] }) => {
      const text = String(sql?.strings?.join("") ?? "");
      if (text.includes("COUNT(*)")) {
        return Promise.resolve([{ count: 20n }]);
      }
      return Promise.resolve(
        Array.from({ length: 25 }, (_, index) => ({
          id: `job-${index}`,
          invoiceReadyAt: new Date(`2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`),
          updatedAt: new Date("2026-07-28T00:00:00.000Z"),
        })),
      );
    });
    prisma.trip.findMany.mockImplementation((args: any) => {
      if (args.select?.driverId) return Promise.resolve([]);
      if (args.where?.plannedEndAt) {
        return Promise.resolve(
          Array.from({ length: 25 }, (_, index) => ({
            id: `overdue-${index}`,
            jobId: `job-o-${index}`,
            plannedEndAt: new Date(
              `2026-08-${String((index % 10) + 1).padStart(2, "0")}T00:00:00.000Z`,
            ),
          })),
        );
      }
      if (args.where?.plannedStartAt) {
        return Promise.resolve(
          Array.from({ length: 25 }, (_, index) => ({
            id: `soon-${index}`,
            jobId: `job-s-${index}`,
            plannedStartAt: new Date(
              `2026-08-11T${String(12 + (index % 10)).padStart(2, "0")}:00:00.000Z`,
            ),
          })),
        );
      }
      return Promise.resolve([]);
    });

    const svc = new DashboardService(prisma);
    const summary = await svc.getSummary("tenant-a");
    expect(summary.attention.total).toBe(60);
    expect(summary.attention.counts).toEqual({
      critical: 40,
      warning: 20,
      info: 0,
    });
    expect(summary.attention.items).toHaveLength(25);
    expect(
      summary.attention.counts.critical +
        summary.attention.counts.warning +
        summary.attention.counts.info,
    ).toBe(summary.attention.total);
  });
});
