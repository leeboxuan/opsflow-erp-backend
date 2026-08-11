import { BadRequestException, Injectable } from "@nestjs/common";
import {
  JobStatus,
  InventoryUnitStatus,
  OrderStatus,
  TripStatus,
} from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { resolveDashboardDateRange } from "./dashboard-date-range";
import {
  DASHBOARD_ATTENTION_ITEM_LIMIT,
  buildDashboardAttention,
  buildOverdueActiveTripItem,
  buildOverdueActiveTripWhere,
  buildReadyNotInvoicedItem,
  buildUnassignedStartingSoonItem,
  buildUnassignedStartingSoonWhere,
} from "./dashboard-attention";
import {
  buildCompletedScheduledTripsInPeriodWhere,
  buildDashboardKpis,
  buildJobsInPeriodWhere,
  buildPendingDriverAssignmentWhere,
  buildScheduledTripsInPeriodWhere,
  buildTripsCompletedInPeriodWhere,
  buildTripsInProgressWhere,
} from "./dashboard-kpis";
import {
  buildDashboardJobMetrics,
  buildJobStatusCountMap,
  readyForInvoiceNotInvoicedCountSql,
  readyForInvoiceNotInvoicedListSql,
} from "./dashboard-job-metrics";
import type { DashboardSummaryQueryDto } from "./dto";

function toCountMap<T extends string>(
  rows: Array<{ key: T; count: number }>,
  allKeys: T[],
) {
  const map: Record<string, number> = {};
  for (const k of allKeys) map[k] = 0;
  for (const r of rows) map[r.key] = r.count;
  return map as Record<T, number>;
}

type ReadyNotInvoicedListRow = {
  id: string;
  invoiceReadyAt: Date | null;
  updatedAt: Date;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(
    tenantId: string | null,
    query: DashboardSummaryQueryDto = {},
  ) {
    if (!tenantId) {
      throw new BadRequestException("Tenant context is required for dashboard");
    }

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const attentionLimit = DASHBOARD_ATTENTION_ITEM_LIMIT;

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const range = resolveDashboardDateRange(
      { from: query.from, to: query.to },
      tenant?.timezone,
      now,
    );

    const unassignedWhere = buildUnassignedStartingSoonWhere(tenantId, now);
    const overdueWhere = buildOverdueActiveTripWhere(tenantId, now);

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
      jobsInPeriod,
      tripsInProgress,
      tripsCompletedInPeriod,
      pendingDriverAssignment,
      scheduledTripsInPeriod,
      completedScheduledTripsInPeriod,
      unassignedStartingSoonCount,
      overdueActiveTripCount,
      unassignedStartingSoonRows,
      overdueActiveTripRows,
      readyNotInvoicedRows,
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
      this.prisma
        .$queryRaw(readyForInvoiceNotInvoicedCountSql(tenantId))
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
      this.prisma.job.count({
        where: buildJobsInPeriodWhere(tenantId, range),
      }),
      this.prisma.trip.count({
        where: buildTripsInProgressWhere(tenantId),
      }),
      this.prisma.trip.count({
        where: buildTripsCompletedInPeriodWhere(tenantId, range),
      }),
      this.prisma.trip.count({
        where: buildPendingDriverAssignmentWhere(tenantId),
      }),
      this.prisma.trip.count({
        where: buildScheduledTripsInPeriodWhere(tenantId, range),
      }),
      this.prisma.trip.count({
        where: buildCompletedScheduledTripsInPeriodWhere(tenantId, range),
      }),
      this.prisma.trip.count({ where: unassignedWhere }),
      this.prisma.trip.count({ where: overdueWhere }),
      this.prisma.trip.findMany({
        where: unassignedWhere,
        orderBy: [{ plannedStartAt: "asc" }, { id: "asc" }],
        take: attentionLimit,
        select: {
          id: true,
          jobId: true,
          plannedStartAt: true,
        },
      }),
      this.prisma.trip.findMany({
        where: overdueWhere,
        orderBy: [{ plannedEndAt: "asc" }, { id: "asc" }],
        take: attentionLimit,
        select: {
          id: true,
          jobId: true,
          plannedEndAt: true,
        },
      }),
      this.prisma
        .$queryRaw(readyForInvoiceNotInvoicedListSql(tenantId, attentionLimit))
        .then((rows: ReadyNotInvoicedListRow[]) => rows),
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

    const kpis = buildDashboardKpis({
      jobsInPeriod,
      tripsInProgress,
      tripsCompletedInPeriod,
      pendingDriverAssignment,
      readyToInvoiceNotInvoiced: readyForInvoiceNotInvoiced,
      scheduledTripsInPeriod,
      completedScheduledTripsInPeriod,
    });

    const attention = buildDashboardAttention({
      unassignedCount: unassignedStartingSoonCount,
      overdueCount: overdueActiveTripCount,
      readyNotInvoicedCount: readyForInvoiceNotInvoiced,
      unassignedItems: unassignedStartingSoonRows
        .filter(
          (
            row,
          ): row is {
            id: string;
            jobId: string;
            plannedStartAt: Date;
          } => row.jobId != null && row.plannedStartAt instanceof Date,
        )
        .map((row) =>
          buildUnassignedStartingSoonItem({
            id: row.id,
            jobId: row.jobId,
            plannedStartAt: row.plannedStartAt,
          }),
        ),
      overdueItems: overdueActiveTripRows
        .filter(
          (
            row,
          ): row is {
            id: string;
            jobId: string;
            plannedEndAt: Date;
          } => row.jobId != null && row.plannedEndAt instanceof Date,
        )
        .map((row) =>
          buildOverdueActiveTripItem({
            id: row.id,
            jobId: row.jobId,
            plannedEndAt: row.plannedEndAt,
          }),
        ),
      readyNotInvoicedItems: readyNotInvoicedRows.map((row) =>
        buildReadyNotInvoicedItem({
          id: row.id,
          invoiceReadyAt: row.invoiceReadyAt,
          updatedAt: row.updatedAt,
        }),
      ),
      limit: attentionLimit,
    });

    return {
      timeZone: range.timeZone,
      from: range.from,
      to: range.to,
      kpis,
      attention,

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
