import { Injectable } from "@nestjs/common";
import { JobStatus, Prisma, TripStatus } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import {
  StatisticsFinanceCurrencyGroupDto,
  StatisticsFinanceDto,
  StatisticsFinanceQueryDto,
} from "./dto";
import {
  COMPLETED_TRIP_STATUSES,
  DEFAULT_PAYOUT_CURRENCY,
  RECOGNIZED_INVOICE_STATUSES,
  SCAN_INVOICE_SNAPSHOT_SOURCE_JOB_IDS,
  STATISTICS_FINANCE_DYNAMIC_LIMITATIONS,
  STATISTICS_FINANCE_LIMITATIONS,
} from "./statistics.constants";
import { resolveStatisticsDateRange } from "./statistics-date-range";
import {
  completedTripReportingTimestamp,
  evaluateGrossProfitEligibility,
  grossMarginBasisPoints,
  isOperationallyCompletedJob,
  normalizeCurrency,
  resolveCompletedTripPayoutState,
} from "./statistics.predicates";
import { resolveCanonicalTripPayoutCents } from "../transport/trips/trip-payout.helpers";

const FINANCE_JOB_BATCH_SIZE = 200;

type FinancePayoutLine = {
  totalCents: number | null;
  amountCents: number | null;
  quantity: number;
  isSelectableForTripEarning: boolean;
};

type FinanceTrip = {
  id: string;
  jobId: string | null;
  status: TripStatus;
  closedAt: Date | null;
  driverEarningCents: number | null;
  payoutLines: FinancePayoutLine[];
};

type ChargeGroup = {
  jobId: string;
  currency: string;
  _sum: { amountCents: number | null };
  _count: { _all: number };
};

type InvoiceCurrencyGroup = {
  currency: string;
  _sum: { totalCents: number | null };
};

type CurrencyGroupAccumulator = {
  currency: string;
  jobChargesCents: number;
  issuedInvoiceValueCents: number;
  paidInvoiceValueCents: number;
  uninvoicedReadyValueCents: number;
  recordedTripPayoutCents: number;
  attributableJobPayoutCents: number;
  grossProfitCents: number;
  eligibleRevenueCents: number;
  hasEligibleProfit: boolean;
};

type FinanceAccumulator = {
  groups: Map<string, CurrencyGroupAccumulator>;
  limitations: Set<string>;
  completedJobsMissingCharges: number;
  completedTripsMissingPayouts: number;
  excludedFromProfit: number;
};

function safeInteger(value: number | null | undefined): number {
  const number = value ?? 0;
  if (!Number.isSafeInteger(number)) {
    throw new RangeError("Finance amount exceeds the safe integer range");
  }
  return number;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Finance total exceeds the safe integer range");
  }
  return result;
}

@Injectable()
export class StatisticsFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  async getFinance(
    tenantId: string,
    query: StatisticsFinanceQueryDto,
  ): Promise<StatisticsFinanceDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const range = resolveStatisticsDateRange(
      { from: query.from, to: query.to },
      tenant?.timezone,
    );
    const accumulator: FinanceAccumulator = {
      groups: new Map(),
      limitations: new Set(STATISTICS_FINANCE_LIMITATIONS),
      completedJobsMissingCharges: 0,
      completedTripsMissingPayouts: 0,
      excludedFromProfit: 0,
    };

    await this.aggregateOperationalFinance(
      tenantId,
      query,
      range,
      accumulator,
    );
    await this.aggregateInvoices(tenantId, query, range, accumulator);
    await this.aggregateUninvoicedReady(
      tenantId,
      query,
      range,
      accumulator,
    );
    for (const group of accumulator.groups.values()) {
      if (group.hasEligibleProfit && group.eligibleRevenueCents <= 0) {
        accumulator.limitations.add(
          STATISTICS_FINANCE_DYNAMIC_LIMITATIONS
            .NONPOSITIVE_MARGIN_REVENUE,
        );
      }
    }

    return {
      timeZone: range.timeZone,
      generatedAt: new Date(),
      limitations: Array.from(accumulator.limitations),
      currencyGroups: Array.from(accumulator.groups.values())
        .sort((a, b) => a.currency.localeCompare(b.currency))
        .map((group): StatisticsFinanceCurrencyGroupDto => ({
          currency: group.currency,
          jobChargesCents: group.jobChargesCents,
          issuedInvoiceValueCents: group.issuedInvoiceValueCents,
          paidInvoiceValueCents: group.paidInvoiceValueCents,
          uninvoicedReadyValueCents: group.uninvoicedReadyValueCents,
          recordedTripPayoutCents: group.recordedTripPayoutCents,
          attributableJobPayoutCents:
            group.attributableJobPayoutCents,
          grossProfitCents: group.hasEligibleProfit
            ? group.grossProfitCents
            : null,
          grossMarginBasisPoints: group.hasEligibleProfit
            ? grossMarginBasisPoints(
                group.grossProfitCents,
                group.eligibleRevenueCents,
              )
            : null,
        })),
      exceptionCounts: {
        completedJobsMissingCharges:
          accumulator.completedJobsMissingCharges,
        completedTripsMissingPayouts:
          accumulator.completedTripsMissingPayouts,
        excludedFromProfit: accumulator.excludedFromProfit,
      },
    };
  }

  private async aggregateOperationalFinance(
    tenantId: string,
    query: StatisticsFinanceQueryDto,
    range: { gte: Date; lt: Date },
    accumulator: FinanceAccumulator,
  ): Promise<void> {
    let cursor: string | undefined;
    const payoutCurrency = normalizeCurrency(DEFAULT_PAYOUT_CURRENCY);

    for (;;) {
      const jobs = (await this.prisma.job.findMany({
        where: {
          ...this.buildJobScope(tenantId, query),
          trips: {
            some: {
              tenantId,
              status: { in: [...COMPLETED_TRIP_STATUSES] },
              closedAt: { gte: range.gte, lt: range.lt },
            },
          },
        },
        orderBy: { id: "asc" },
        take: FINANCE_JOB_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      })) as Array<{ id: string }>;
      if (jobs.length === 0) break;

      const jobIds = jobs.map((job) => job.id);
      const [tripRows, chargeGroups] = await Promise.all([
        this.prisma.trip.findMany({
          where: { tenantId, jobId: { in: jobIds } },
          select: {
            id: true,
            jobId: true,
            status: true,
            closedAt: true,
            driverEarningCents: true,
          },
        }),
        this.prisma.jobCharge.groupBy({
          by: ["jobId", "currency"],
          where: { tenantId, jobId: { in: jobIds } },
          _sum: { amountCents: true },
          _count: { _all: true },
        }),
      ]);
      const typedTrips = tripRows as Array<
        Omit<FinanceTrip, "payoutLines">
      >;
      const completedTripIds = typedTrips
        .filter((trip) =>
          COMPLETED_TRIP_STATUSES.includes(
            trip.status as (typeof COMPLETED_TRIP_STATUSES)[number],
          ),
        )
        .map((trip) => trip.id);
      const payoutRows =
        completedTripIds.length > 0
          ? ((await this.prisma.tripPayoutLine.findMany({
              where: {
                tenantId,
                tripId: { in: completedTripIds },
              },
              select: {
                tripId: true,
                totalCents: true,
                amountCents: true,
                quantity: true,
                isSelectableForTripEarning: true,
              },
            })) as Array<FinancePayoutLine & { tripId: string }>)
          : [];
      const payoutLinesByTrip = new Map<string, FinancePayoutLine[]>();
      for (const line of payoutRows) {
        const lines = payoutLinesByTrip.get(line.tripId) ?? [];
        lines.push(line);
        payoutLinesByTrip.set(line.tripId, lines);
      }
      const trips: FinanceTrip[] = typedTrips.map((trip) => ({
        ...trip,
        payoutLines: payoutLinesByTrip.get(trip.id) ?? [],
      }));
      const tripsByJob = new Map<string, FinanceTrip[]>();
      for (const trip of trips) {
        if (!trip.jobId) continue;
        const rows = tripsByJob.get(trip.jobId) ?? [];
        rows.push(trip);
        tripsByJob.set(trip.jobId, rows);
      }
      const chargesByJob = new Map<string, ChargeGroup[]>();
      for (const charge of chargeGroups as ChargeGroup[]) {
        const rows = chargesByJob.get(charge.jobId) ?? [];
        rows.push(charge);
        chargesByJob.set(charge.jobId, rows);
      }

      for (const trip of trips) {
        if (
          !COMPLETED_TRIP_STATUSES.includes(
            trip.status as (typeof COMPLETED_TRIP_STATUSES)[number],
          ) ||
          !trip.closedAt ||
          trip.closedAt < range.gte ||
          trip.closedAt >= range.lt
        ) {
          continue;
        }
        const state = resolveCompletedTripPayoutState(trip);
        if (state?.kind === "recorded") {
          this.addMetric(
            accumulator,
            payoutCurrency,
            "recordedTripPayoutCents",
            state.totalCents,
          );
        } else {
          accumulator.completedTripsMissingPayouts += 1;
        }
      }

      for (const jobId of jobIds) {
        const jobTrips = tripsByJob.get(jobId) ?? [];
        if (!isOperationallyCompletedJob(jobTrips)) continue;
        const reportingTimestamp =
          this.operationalJobReportingTimestamp(jobTrips);
        if (
          !reportingTimestamp ||
          reportingTimestamp < range.gte ||
          reportingTimestamp >= range.lt
        ) {
          continue;
        }

        const rawCharges = chargesByJob.get(jobId) ?? [];
        if (rawCharges.length === 0) {
          accumulator.completedJobsMissingCharges += 1;
        }
        let hasInvalidCurrency = false;
        const validCharges: Array<{
          currency: string;
          amountCents: number;
        }> = [];
        for (const charge of rawCharges) {
          const currency = this.normalizePersistedCurrency(
            charge.currency,
            accumulator,
          );
          if (!currency) {
            hasInvalidCurrency = true;
            continue;
          }
          const amountCents = safeInteger(charge._sum.amountCents);
          validCharges.push({ currency, amountCents });
          this.addMetric(
            accumulator,
            currency,
            "jobChargesCents",
            amountCents,
          );
        }

        const attributablePayout = jobTrips
          .filter((trip) => trip.status !== TripStatus.CANCELLED)
          .reduce(
            (total, trip) =>
              safeAdd(
                total,
                resolveCanonicalTripPayoutCents(trip) ?? 0,
              ),
            0,
          );
        if (attributablePayout !== 0) {
          this.addMetric(
            accumulator,
            payoutCurrency,
            "attributableJobPayoutCents",
            attributablePayout,
          );
        }

        if (hasInvalidCurrency) {
          accumulator.excludedFromProfit += 1;
          continue;
        }
        const eligibility = evaluateGrossProfitEligibility({
          trips: jobTrips,
          charges: validCharges,
          payoutCurrency,
        });
        if (!eligibility.eligible) {
          accumulator.excludedFromProfit += 1;
          if (
            "reason" in eligibility &&
            (eligibility.reason === "multiple_revenue_currencies" ||
              eligibility.reason ===
                "revenue_payout_currency_mismatch")
          ) {
            accumulator.limitations.add(
              STATISTICS_FINANCE_DYNAMIC_LIMITATIONS
                .PROFIT_CURRENCY_MISMATCH,
            );
          }
          continue;
        }
        const group = this.ensureGroup(
          accumulator,
          eligibility.currency,
        );
        group.grossProfitCents = safeAdd(
          group.grossProfitCents,
          eligibility.grossProfitCents,
        );
        group.eligibleRevenueCents = safeAdd(
          group.eligibleRevenueCents,
          eligibility.revenueCents,
        );
        group.hasEligibleProfit = true;
      }

      cursor = jobs[jobs.length - 1].id;
      if (jobs.length < FINANCE_JOB_BATCH_SIZE) break;
    }
  }

  private async aggregateInvoices(
    tenantId: string,
    query: StatisticsFinanceQueryDto,
    range: { gte: Date; lt: Date },
    accumulator: FinanceAccumulator,
  ): Promise<void> {
    const aggregateForSourceJobIds = async (
      sourceJobIds?: string[],
    ): Promise<void> => {
      const sourceJobWhere = sourceJobIds
        ? { sourceJobId: { in: sourceJobIds } }
        : {};
      const [issued, paid] = await Promise.all([
        this.prisma.invoice.groupBy({
          by: ["currency"],
          where: {
            tenantId,
            status: { in: [...RECOGNIZED_INVOICE_STATUSES] },
            ...sourceJobWhere,
            OR: [
              { issuedAt: { gte: range.gte, lt: range.lt } },
              {
                issuedAt: null,
                sentAt: { gte: range.gte, lt: range.lt },
              },
              {
                issuedAt: null,
                sentAt: null,
                issueDate: { gte: range.gte, lt: range.lt },
              },
            ],
          },
          _sum: { totalCents: true },
        }),
        this.prisma.invoice.groupBy({
          by: ["currency"],
          where: {
            tenantId,
            status: "PAID",
            paidAt: { gte: range.gte, lt: range.lt },
            ...sourceJobWhere,
          },
          _sum: { totalCents: true },
        }),
      ]);
      this.addInvoiceGroups(
        accumulator,
        issued as InvoiceCurrencyGroup[],
        "issuedInvoiceValueCents",
      );
      this.addInvoiceGroups(
        accumulator,
        paid as InvoiceCurrencyGroup[],
        "paidInvoiceValueCents",
      );
    };

    if (!query.customerId && !query.jobId) {
      await aggregateForSourceJobIds();
      return;
    }
    await this.forEachFilteredJobIdBatch(
      tenantId,
      query,
      aggregateForSourceJobIds,
    );
  }

  private async aggregateUninvoicedReady(
    tenantId: string,
    query: StatisticsFinanceQueryDto,
    range: { gte: Date; lt: Date },
    accumulator: FinanceAccumulator,
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const jobs = (await this.prisma.job.findMany({
        where: {
          ...this.buildJobScope(tenantId, query),
          status: JobStatus.READY_FOR_INVOICE,
          invoiceReadyAt: { gte: range.gte, lt: range.lt },
        },
        orderBy: { id: "asc" },
        take: FINANCE_JOB_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      })) as Array<{ id: string }>;
      if (jobs.length === 0) break;
      const jobIds = jobs.map((job) => job.id);
      const [recognizedInvoices, chargeGroups] = await Promise.all([
        this.prisma.invoice.findMany({
          where: {
            tenantId,
            sourceJobId: { in: jobIds },
            status: { in: [...RECOGNIZED_INVOICE_STATUSES] },
          },
          select: { sourceJobId: true },
        }),
        this.prisma.jobCharge.groupBy({
          by: ["jobId", "currency"],
          where: { tenantId, jobId: { in: jobIds } },
          _sum: { amountCents: true },
        }),
      ]);
      const invoicedJobIds = new Set(
        (
          recognizedInvoices as Array<{ sourceJobId: string | null }>
        )
          .map((invoice) => invoice.sourceJobId)
          .filter((jobId): jobId is string => typeof jobId === "string"),
      );
      for (const charge of chargeGroups as Array<
        Omit<ChargeGroup, "_count">
      >) {
        if (invoicedJobIds.has(charge.jobId)) continue;
        const currency = this.normalizePersistedCurrency(
          charge.currency,
          accumulator,
        );
        if (!currency) continue;
        this.addMetric(
          accumulator,
          currency,
          "uninvoicedReadyValueCents",
          safeInteger(charge._sum.amountCents),
        );
      }

      cursor = jobs[jobs.length - 1].id;
      if (jobs.length < FINANCE_JOB_BATCH_SIZE) break;
    }
    if (SCAN_INVOICE_SNAPSHOT_SOURCE_JOB_IDS) {
      throw new Error(
        "Invoice snapshot job-link scanning requires an approved query implementation",
      );
    }
  }

  private async forEachFilteredJobIdBatch(
    tenantId: string,
    query: StatisticsFinanceQueryDto,
    callback: (jobIds: string[]) => Promise<void>,
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const jobs = (await this.prisma.job.findMany({
        where: this.buildJobScope(tenantId, query),
        orderBy: { id: "asc" },
        take: FINANCE_JOB_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      })) as Array<{ id: string }>;
      if (jobs.length === 0) break;
      await callback(jobs.map((job) => job.id));
      cursor = jobs[jobs.length - 1].id;
      if (jobs.length < FINANCE_JOB_BATCH_SIZE) break;
    }
  }

  private buildJobScope(
    tenantId: string,
    query: StatisticsFinanceQueryDto,
  ): Prisma.JobWhereInput {
    return {
      tenantId,
      ...(query.jobId ? { id: query.jobId } : {}),
      ...(query.customerId
        ? { customerCompanyId: query.customerId }
        : {}),
    };
  }

  private operationalJobReportingTimestamp(
    trips: FinanceTrip[],
  ): Date | null {
    const timestamps = trips
      .filter((trip) => trip.status !== TripStatus.CANCELLED)
      .map((trip) => completedTripReportingTimestamp(trip))
      .filter((timestamp): timestamp is Date => timestamp instanceof Date);
    if (timestamps.length === 0) return null;
    return new Date(
      Math.max(...timestamps.map((timestamp) => timestamp.getTime())),
    );
  }

  private normalizePersistedCurrency(
    currency: string,
    accumulator: FinanceAccumulator,
  ): string | null {
    try {
      return normalizeCurrency(currency);
    } catch {
      accumulator.limitations.add(
        STATISTICS_FINANCE_DYNAMIC_LIMITATIONS.INVALID_CURRENCY,
      );
      return null;
    }
  }

  private addInvoiceGroups(
    accumulator: FinanceAccumulator,
    groups: InvoiceCurrencyGroup[],
    metric:
      | "issuedInvoiceValueCents"
      | "paidInvoiceValueCents",
  ): void {
    for (const row of groups) {
      const currency = this.normalizePersistedCurrency(
        row.currency,
        accumulator,
      );
      if (!currency) continue;
      this.addMetric(
        accumulator,
        currency,
        metric,
        safeInteger(row._sum.totalCents),
      );
    }
  }

  private addMetric(
    accumulator: FinanceAccumulator,
    currency: string,
    metric:
      | "jobChargesCents"
      | "issuedInvoiceValueCents"
      | "paidInvoiceValueCents"
      | "uninvoicedReadyValueCents"
      | "recordedTripPayoutCents"
      | "attributableJobPayoutCents",
    amountCents: number,
  ): void {
    const group = this.ensureGroup(accumulator, currency);
    group[metric] = safeAdd(group[metric], amountCents);
  }

  private ensureGroup(
    accumulator: FinanceAccumulator,
    currency: string,
  ): CurrencyGroupAccumulator {
    const existing = accumulator.groups.get(currency);
    if (existing) return existing;
    const group: CurrencyGroupAccumulator = {
      currency,
      jobChargesCents: 0,
      issuedInvoiceValueCents: 0,
      paidInvoiceValueCents: 0,
      uninvoicedReadyValueCents: 0,
      recordedTripPayoutCents: 0,
      attributableJobPayoutCents: 0,
      grossProfitCents: 0,
      eligibleRevenueCents: 0,
      hasEligibleProfit: false,
    };
    accumulator.groups.set(currency, group);
    return group;
  }
}
