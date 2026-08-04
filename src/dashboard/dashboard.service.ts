import { BadRequestException, Injectable } from "@nestjs/common";
import { JobStatus, InventoryUnitStatus, OrderStatus, Prisma, TripStatus } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import {
  INVOICED_INVOICE_STATUSES,
  buildDashboardJobMetrics,
  buildJobStatusCountMap,
} from "./dashboard-job-metrics";

function toCountMap<T extends string>(
  rows: Array<{ key: T; count: number }>,
  allKeys: T[],
) {
  const map: Record<string, number> = {};
  for (const k of allKeys) map[k] = 0;
  for (const r of rows) map[r.key] = r.count;
  return map as Record<T, number>;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(tenantId: string | null) {
    if (!tenantId) {
      throw new BadRequestException("Tenant context is required for dashboard");
    }

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      jobTotal,
      jobByStatusRaw,
      readyForInvoiceBroadCount,
      readyForInvoiceNotInvoiced,
      orderTotal,
      orderByStatusRaw,
      tripTotal,
      tripByStatusRaw,
      tripsActiveToday,
      unitsTotal,
      unitsByStatusRaw,
      driversTotal,
      activeTrips,
      activity,
    ] = await Promise.all([
      this.prisma.job.count({ where: { tenantId } }),
      this.prisma.job.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.job.count({
        where: {
          tenantId,
          status: { notIn: [JobStatus.CANCELLED, JobStatus.COMPLETED] },
          OR: [
            { status: JobStatus.READY_FOR_INVOICE },
            { invoiceReadyAt: { not: null } },
          ],
        },
      }),
      // Count READY_FOR_INVOICE jobs with no Sent/Issued/Paid invoice (same math as ID-set subtract)
      this.prisma
        .$queryRaw(
          Prisma.sql`
        SELECT COUNT(*)::bigint AS count
        FROM "jobs" j
        WHERE j."tenantId" = ${tenantId}
          AND j."status"::text = ${JobStatus.READY_FOR_INVOICE}
          AND NOT EXISTS (
            SELECT 1
            FROM "invoices" i
            WHERE i."tenantId" = ${tenantId}
              AND i."sourceJobId" = j."id"
              AND i."status" IN (${Prisma.join([...INVOICED_INVOICE_STATUSES])})
          )
      `,
        )
        .then((rows: Array<{ count: bigint }>) => Number(rows[0]?.count ?? 0n)),
      this.prisma.transportOrder.count({ where: { tenantId } }),
      this.prisma.transportOrder.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.trip.count({ where: { tenantId } }),
      this.prisma.trip.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.trip.count({
        where: {
          tenantId,
          status: { in: [TripStatus.PUBLISHED, TripStatus.ONGOING] },
          OR: [{ startedAt: { gte: last24h } }, { updatedAt: { gte: last24h } }],
        },
      }),
      this.prisma.inventory_units.count({ where: { tenantId } }),
      this.prisma.inventory_units.groupBy({
        by: ["status"],
        where: { tenantId },
        _count: { _all: true },
      }),
      this.prisma.drivers.count({ where: { tenantId } }),
      this.prisma.trip.findMany({
        where: {
          tenantId,
          status: { in: [TripStatus.PUBLISHED, TripStatus.ONGOING] },
        },
        select: { driverId: true },
        take: 500,
      }),
      this.prisma.eventLog.findMany({
        where: { tenantId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: {
          id: true,
          entityType: true,
          entityId: true,
          eventType: true,
          createdAt: true,
          payload: true,
        },
      }),
    ]);

    const jobByStatus = buildJobStatusCountMap(
      jobByStatusRaw.map((r) => ({
        status: r.status,
        count: r._count._all,
      })),
    );

    const jobs = buildDashboardJobMetrics({
      total: jobTotal,
      byStatus: jobByStatus,
      readyForInvoiceNotInvoiced,
      readyForInvoiceBroadCount,
    });

    const orderByStatus = toCountMap<OrderStatus>(
      orderByStatusRaw.map((r) => ({ key: r.status, count: r._count._all })),
      Object.values(OrderStatus),
    );

    const ordersInProgress =
      (orderByStatus.Confirmed ?? 0) +
      (orderByStatus.Planned ?? 0) +
      (orderByStatus.Dispatched ?? 0) +
      (orderByStatus.InTransit ?? 0);

    const ordersAwaitingInvoice = jobs.readyForInvoiceNotInvoiced;

    const tripByStatus = toCountMap<TripStatus>(
      tripByStatusRaw.map((r) => ({ key: r.status, count: r._count._all })),
      Object.values(TripStatus),
    );

    const unitsByStatus = toCountMap<InventoryUnitStatus>(
      unitsByStatusRaw.map((r) => ({ key: r.status, count: r._count._all })),
      Object.values(InventoryUnitStatus),
    );

    const unitsAvailable = unitsByStatus.Available ?? 0;

    const activeDriverIds = new Set(
      activeTrips.map((t) => t.driverId).filter(Boolean) as string[],
    );

    return {
      jobs,

      orders: {
        total: orderTotal,
        inProgress: ordersInProgress,
        awaitingInvoice: ordersAwaitingInvoice,
        byStatus: orderByStatus,
      },

      trips: {
        total: tripTotal,
        activeToday: tripsActiveToday,
        byStatus: tripByStatus,
      },
      inventory: { unitsTotal, unitsAvailable, unitsByStatus },
      drivers: { total: driversTotal, activeNow: activeDriverIds.size },
      activity,
      generatedAt: now.toISOString(),
    };
  }
}
