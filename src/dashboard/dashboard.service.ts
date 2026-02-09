import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InventoryUnitStatus, OrderStatus, TripStatus } from '@prisma/client';

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
      throw new BadRequestException('Tenant context is required for dashboard');
    }

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // ---- Orders ----
    const orderTotal = await this.prisma.transportOrder.count({
      where: { tenantId },
    });

    const orderByStatusRaw = await this.prisma.transportOrder.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
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

    // ---- Trips ----
    const tripTotal = await this.prisma.trip.count({ where: { tenantId } });

    const tripByStatusRaw = await this.prisma.trip.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    });

    const tripByStatus = toCountMap<TripStatus>(
      tripByStatusRaw.map((r) => ({ key: r.status, count: r._count._all })),
      Object.values(TripStatus),
    );

    const tripsActiveToday = await this.prisma.trip.count({
      where: {
        tenantId,
        status: { in: [TripStatus.Dispatched, TripStatus.InTransit] },
        OR: [{ startedAt: { gte: last24h } }, { updatedAt: { gte: last24h } }],
      },
    });

    // ---- Inventory Units ----
    const unitsTotal = await this.prisma.inventory_units.count({
      where: { tenantId },
    });

    const unitsByStatusRaw = await this.prisma.inventory_units.groupBy({
      by: ['status'],
      where: { tenantId },
      _count: { _all: true },
    });

    const unitsByStatus = toCountMap<InventoryUnitStatus>(
      unitsByStatusRaw.map((r) => ({ key: r.status, count: r._count._all })),
      Object.values(InventoryUnitStatus),
    );

    const unitsAvailable = unitsByStatus.Available ?? 0;

    // ---- Drivers ----
    const driversTotal = await this.prisma.drivers.count({ where: { tenantId } });

    const activeTrips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        status: { in: [TripStatus.Dispatched, TripStatus.InTransit] },
      },
      select: { driverId: true },
      take: 500,
    });

    const activeDriverIds = new Set(
      activeTrips.map((t) => t.driverId).filter(Boolean) as string[],
    );

    // ---- Recent Activity ----
    const activity = await this.prisma.eventLog.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        entityType: true,
        entityId: true,
        eventType: true,
        createdAt: true,
        payload: true,
      },
    });

    return {
      orders: { total: orderTotal, inProgress: ordersInProgress, byStatus: orderByStatus },
      trips: { total: tripTotal, activeToday: tripsActiveToday, byStatus: tripByStatus },
      inventory: { unitsTotal, unitsAvailable, unitsByStatus },
      drivers: { total: driversTotal, activeNow: activeDriverIds.size },
      activity,
      generatedAt: now.toISOString(),
    };
  }
}
