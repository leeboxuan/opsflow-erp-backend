import { Injectable, BadRequestException, NotFoundException } from "@nestjs/common";
import { TripStatus } from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import {
  buildPaginationMeta,
  parsePaginationFromQuery,
} from "../../shared/common/pagination";
import { CANONICAL_TRIP_PAYOUT_LINE_SELECT } from "../trips/trip-payout.helpers";
import {
  DEFAULT_DRIVER_EARNING_CURRENCY,
  DEFAULT_TENANT_TIMEZONE,
  DriverWalletSummaryByMonth,
  getCurrentMonthKeyInTimeZone,
  getSafeTenantTimezone,
  mapTripsToWalletSummaryRows,
  parseCalendarMonthToUtcRangeInTimeZone,
  resolveDriverTripEarningCents,
  sumWalletTripRowsCents,
  humanTripDisplayRef,
} from "./driver-trip-earnings.helpers";

const TENANT_TIMEZONE_CACHE_TTL_MS = 5 * 60 * 1000;

export type DriverEarningsTotals = {
  month: string;
  monthCents: number;
  monthCompletedTripCount: number;
  lifetimeCents: number;
  lifetimeCompletedTripCount: number;
  currency: string;
  timeZone: string;
};

export type DriverEarningsTransactionDto = {
  id: string;
  amountCents: number;
  currency: string;
  type: string;
  description: string | null;
  effectiveAt: Date | null;
  tripId: string;
  jobId: string | null;
  jobInternalRef: string | null;
};

export type DriverIncentiveSummaryRow = {
  driverId: string;
  driverName: string;
  monthCents: number;
  completedTripCount: number;
  averageCents: number;
  vehiclePlate: string | null;
};

export type DriverIncentiveTripRow = {
  date: Date | null;
  tripDisplayRef: string;
  payoutLabel: string | null;
  amountCents: number;
  jobRef: string | null;
};

export type DriverIncentiveDetail = {
  driverId: string;
  driverName: string;
  month: string;
  totalCents: number;
  completedTripCount: number;
  averageCents: number;
  vehiclePlate: string | null;
  currency: string;
  timeZone: string;
  trips: DriverIncentiveTripRow[];
};

/**
 * Canonical driver trip-payout earnings (mobile wallet SoT).
 * Mobile and admin staff endpoints must both delegate here.
 */
@Injectable()
export class DriverTripEarningsService {
  private readonly tenantTimezoneCache = new Map<
    string,
    { timezone: string; expiresAt: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async getTenantTimeZone(tenantId: string): Promise<string> {
    const now = Date.now();
    const cached = this.tenantTimezoneCache.get(tenantId);
    if (cached && cached.expiresAt > now) {
      return cached.timezone;
    }
    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { timezone: true },
      });
      const timezone = getSafeTenantTimezone(tenant?.timezone);
      this.tenantTimezoneCache.set(tenantId, {
        timezone,
        expiresAt: now + TENANT_TIMEZONE_CACHE_TTL_MS,
      });
      return timezone;
    } catch {
      return cached?.timezone ?? DEFAULT_TENANT_TIMEZONE;
    }
  }

  async resolveMonthKey(tenantId: string, month?: string | null): Promise<string> {
    const trimmed = month?.trim();
    if (trimmed) {
      const tz = await this.getTenantTimeZone(tenantId);
      // Validate format/range using the same helper mobile uses.
      parseCalendarMonthToUtcRangeInTimeZone(trimmed, tz);
      return trimmed;
    }
    const tz = await this.getTenantTimeZone(tenantId);
    return getCurrentMonthKeyInTimeZone(tz);
  }

  /**
   * Exact mobile wallet summary contract.
   * Preserves response shape and calculation of GET /drivers/jobs/wallet/summary.
   */
  async getWalletSummaryByMonth(
    tenantId: string,
    driverUserId: string,
    month: string,
  ): Promise<DriverWalletSummaryByMonth> {
    const monthKey = String(month ?? "").trim();
    if (!monthKey) {
      throw new BadRequestException("month must be YYYY-MM");
    }
    const tz = await this.getTenantTimeZone(tenantId);
    const range = parseCalendarMonthToUtcRangeInTimeZone(monthKey, tz);
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
        OR: [
          { closedAt: { gte: range.gte, lt: range.lt } },
          { closedAt: null, updatedAt: { gte: range.gte, lt: range.lt } },
        ],
      },
      orderBy: [{ closedAt: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        jobId: true,
        title: true,
        status: true,
        closedAt: true,
        updatedAt: true,
        driverEarningCents: true,
        earningLabelSnapshot: true,
        payoutLines: {
          select: CANONICAL_TRIP_PAYOUT_LINE_SELECT,
        },
        job: {
          select: {
            internalRef: true,
          },
        },
      },
    });

    const tripRows = mapTripsToWalletSummaryRows(trips);
    const totalCents = sumWalletTripRowsCents(tripRows);

    return {
      month: monthKey,
      totalCents,
      completedTripCount: tripRows.length,
      trips: tripRows,
    };
  }

  /**
   * Lifetime = sum of resolveDriverTripEarningCents over all same-tenant
   * COMPLETED/DONE trips for the driver (no month filter).
   */
  async getLifetimeTotals(
    tenantId: string,
    driverUserId: string,
  ): Promise<{
    lifetimeCents: number;
    completedTripCount: number;
    currency: string;
  }> {
    const trips = await this.prisma.trip.findMany({
      where: {
        tenantId,
        assignedDriverUserId: driverUserId,
        status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
      },
      select: {
        driverEarningCents: true,
        payoutLines: { select: CANONICAL_TRIP_PAYOUT_LINE_SELECT },
      },
    });

    let lifetimeCents = 0;
    for (const trip of trips) {
      lifetimeCents += resolveDriverTripEarningCents(trip) ?? 0;
    }

    return {
      lifetimeCents,
      completedTripCount: trips.length,
      currency: DEFAULT_DRIVER_EARNING_CURRENCY,
    };
  }

  async getEarningsTotals(
    tenantId: string,
    driverUserId: string,
    month?: string | null,
  ): Promise<DriverEarningsTotals> {
    const monthKey = await this.resolveMonthKey(tenantId, month);
    const tz = await this.getTenantTimeZone(tenantId);
    const [monthSummary, lifetime] = await Promise.all([
      this.getWalletSummaryByMonth(tenantId, driverUserId, monthKey),
      this.getLifetimeTotals(tenantId, driverUserId),
    ]);

    return {
      month: monthKey,
      monthCents: monthSummary.totalCents,
      monthCompletedTripCount: monthSummary.completedTripCount,
      lifetimeCents: lifetime.lifetimeCents,
      lifetimeCompletedTripCount: lifetime.completedTripCount,
      currency: DEFAULT_DRIVER_EARNING_CURRENCY,
      timeZone: tz,
    };
  }

  /**
   * Paginated trip-payout "transactions" for a month (mobile SoT line items).
   * Bonuses/ledger rows are intentionally not mixed in.
   */
  async listEarningsTransactions(
    tenantId: string,
    driverUserId: string,
    query?: {
      month?: string;
      page?: unknown;
      pageSize?: unknown;
    },
  ): Promise<{
    data: DriverEarningsTransactionDto[];
    meta: { page: number; pageSize: number; total: number };
    month: string;
    currency: string;
  }> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query ?? {});
    const monthKey = await this.resolveMonthKey(tenantId, query?.month);
    const tz = await this.getTenantTimeZone(tenantId);
    const range = parseCalendarMonthToUtcRangeInTimeZone(monthKey, tz);

    const where = {
      tenantId,
      assignedDriverUserId: driverUserId,
      status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
      OR: [
        { closedAt: { gte: range.gte, lt: range.lt } },
        { closedAt: null, updatedAt: { gte: range.gte, lt: range.lt } },
      ],
    };

    const [total, trips] = await this.prisma.$transaction([
      this.prisma.trip.count({ where }),
      this.prisma.trip.findMany({
        where,
        orderBy: [
          { closedAt: "desc" },
          { updatedAt: "desc" },
          { id: "desc" },
        ],
        skip,
        take,
        select: {
          id: true,
          jobId: true,
          title: true,
          closedAt: true,
          updatedAt: true,
          driverEarningCents: true,
          earningLabelSnapshot: true,
          payoutLines: { select: CANONICAL_TRIP_PAYOUT_LINE_SELECT },
          job: { select: { internalRef: true } },
        },
      }),
    ]);

    const data: DriverEarningsTransactionDto[] = trips.map((trip) => {
      const amountCents = resolveDriverTripEarningCents(trip) ?? 0;
      const ref = trip.job?.internalRef ?? trip.title ?? trip.id;
      return {
        id: trip.id,
        amountCents,
        currency: DEFAULT_DRIVER_EARNING_CURRENCY,
        type: "TripCompleted",
        description: trip.earningLabelSnapshot ?? ref,
        effectiveAt: trip.closedAt ?? trip.updatedAt ?? null,
        tripId: trip.id,
        jobId: trip.jobId ?? null,
        jobInternalRef: trip.job?.internalRef ?? null,
      };
    });

    return {
      data,
      meta: buildPaginationMeta(page, pageSize, total),
      month: monthKey,
      currency: DEFAULT_DRIVER_EARNING_CURRENCY,
    };
  }

  /**
   * Tenant-wide Finance Driver Incentives summary for a calendar month.
   * Arithmetic is the same COMPLETED/DONE + TripPayoutLine resolver as wallet.
   */
  async listTenantDriverIncentiveSummaries(
    tenantId: string,
    query?: { month?: string | null; q?: string | null },
  ): Promise<{
    month: string;
    currency: string;
    timeZone: string;
    data: DriverIncentiveSummaryRow[];
  }> {
    const monthKey = await this.resolveMonthKey(tenantId, query?.month);
    const tz = await this.getTenantTimeZone(tenantId);
    const range = parseCalendarMonthToUtcRangeInTimeZone(monthKey, tz);
    const q = String(query?.q ?? "").trim();

    const drivers = await this.prisma.drivers.findMany({
      where: {
        tenantId,
        userId: { not: null },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                {
                  users: {
                    OR: [
                      { name: { contains: q, mode: "insensitive" } },
                      { displayName: { contains: q, mode: "insensitive" } },
                      { username: { contains: q, mode: "insensitive" } },
                    ],
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        userId: true,
        name: true,
        assignedVehicle: { select: { plateNo: true } },
        assignedFleetVehicle: { select: { plateNo: true } },
        users: { select: { name: true, displayName: true } },
      },
      orderBy: { name: "asc" },
    });

    const userIds = drivers
      .map((driver) => driver.userId)
      .filter((id): id is string => Boolean(id));

    const trips =
      userIds.length === 0
        ? []
        : await this.prisma.trip.findMany({
            where: {
              tenantId,
              assignedDriverUserId: { in: userIds },
              status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
              OR: [
                { closedAt: { gte: range.gte, lt: range.lt } },
                { closedAt: null, updatedAt: { gte: range.gte, lt: range.lt } },
              ],
            },
            select: {
              assignedDriverUserId: true,
              driverEarningCents: true,
              payoutLines: { select: CANONICAL_TRIP_PAYOUT_LINE_SELECT },
            },
          });

    const totals = new Map<string, { cents: number; trips: number }>();
    for (const trip of trips) {
      const driverId = trip.assignedDriverUserId;
      if (!driverId) continue;
      const current = totals.get(driverId) ?? { cents: 0, trips: 0 };
      current.cents += resolveDriverTripEarningCents(trip) ?? 0;
      current.trips += 1;
      totals.set(driverId, current);
    }

    const data: DriverIncentiveSummaryRow[] = drivers
      .filter((driver) => driver.userId)
      .map((driver) => {
        const driverId = driver.userId as string;
        const earned = totals.get(driverId) ?? { cents: 0, trips: 0 };
        const driverName =
          driver.name?.trim() ||
          driver.users?.displayName?.trim() ||
          driver.users?.name?.trim() ||
          "Driver";
        return {
          driverId,
          driverName,
          monthCents: earned.cents,
          completedTripCount: earned.trips,
          averageCents:
            earned.trips > 0 ? Math.round(earned.cents / earned.trips) : 0,
          vehiclePlate:
            driver.assignedFleetVehicle?.plateNo?.trim() ||
            driver.assignedVehicle?.plateNo?.trim() ||
            null,
        };
      });

    return {
      month: monthKey,
      currency: DEFAULT_DRIVER_EARNING_CURRENCY,
      timeZone: tz,
      data,
    };
  }

  async getDriverIncentiveDetail(
    tenantId: string,
    driverUserId: string,
    month?: string | null,
  ): Promise<DriverIncentiveDetail> {
    const driver = await this.prisma.drivers.findFirst({
      where: { tenantId, userId: driverUserId },
      select: {
        userId: true,
        name: true,
        assignedVehicle: { select: { plateNo: true } },
        assignedFleetVehicle: { select: { plateNo: true } },
        users: { select: { name: true, displayName: true } },
      },
    });
    if (!driver?.userId) {
      throw new NotFoundException("Driver not found");
    }

    const monthKey = await this.resolveMonthKey(tenantId, month);
    const tz = await this.getTenantTimeZone(tenantId);
    const summary = await this.getWalletSummaryByMonth(
      tenantId,
      driverUserId,
      monthKey,
    );
    const driverName =
      driver.name?.trim() ||
      driver.users?.displayName?.trim() ||
      driver.users?.name?.trim() ||
      "Driver";

    return {
      driverId: driver.userId,
      driverName,
      month: monthKey,
      totalCents: summary.totalCents,
      completedTripCount: summary.completedTripCount,
      averageCents:
        summary.completedTripCount > 0
          ? Math.round(summary.totalCents / summary.completedTripCount)
          : 0,
      vehiclePlate:
        driver.assignedFleetVehicle?.plateNo?.trim() ||
        driver.assignedVehicle?.plateNo?.trim() ||
        null,
      currency: DEFAULT_DRIVER_EARNING_CURRENCY,
      timeZone: tz,
      trips: summary.trips.map((trip) => ({
        date: trip.completedAt,
        tripDisplayRef: humanTripDisplayRef(trip),
        payoutLabel: trip.earningLabelSnapshot,
        amountCents: trip.driverEarningCents ?? 0,
        jobRef: trip.jobInternalRef,
      })),
    };
  }
}
