import { Injectable, BadRequestException } from "@nestjs/common";
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
}
