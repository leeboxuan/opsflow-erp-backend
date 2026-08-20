import { Injectable } from "@nestjs/common";
import { JobStatus, JobType, TripStatus } from "@prisma/client";
import {
  buildPaginationMeta,
  parsePaginationFromQuery,
} from "../shared/common/pagination";
import { PrismaService } from "../shared/prisma/prisma.service";
import {
  StatisticsCustomerCurrencyGroupDto,
  StatisticsCustomerRowDto,
  StatisticsCustomersDto,
  StatisticsCustomersQueryDto,
  StatisticsFiltersQueryDto,
} from "./dto";
import {
  COMPLETED_TRIP_STATUSES,
  DEFAULT_PAYOUT_CURRENCY,
  RECOGNIZED_INVOICE_STATUSES,
  STATISTICS_CUSTOMER_LIMITATIONS,
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
import { StatisticsTruckingService } from "./statistics-trucking.service";
import { buildStatisticsJobScope, buildStatisticsTripScope } from "./statistics-scope";

const CUSTOMER_JOB_BATCH = 200;

type CustomerOps = {
  customerId: string;
  customerName: string;
  jobs: Set<string>;
  completedJobs: Set<string>;
  containers: Set<string>;
  movements: number;
  completedTrips: number;
  cancelledTrips: number;
  jobTypes: Map<string, number>;
};

type CustomerFinanceGroup = {
  currency: string;
  jobChargesCents: number;
  issuedInvoiceValueCents: number;
  paidInvoiceValueCents: number;
  uninvoicedReadyValueCents: number;
  recordedDriverPayoutCents: number;
  grossProfitCents: number;
  eligibleRevenueCents: number;
  hasEligibleProfit: boolean;
  profitUnavailable: boolean;
};

function safeInteger(value: number | null | undefined): number {
  const number = value ?? 0;
  if (!Number.isSafeInteger(number)) {
    throw new RangeError("Customer statistic exceeds the safe integer range");
  }
  return number;
}

function safeAdd(left: number, right: number): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Customer total exceeds the safe integer range");
  }
  return result;
}

@Injectable()
export class StatisticsCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trucking: StatisticsTruckingService,
  ) {}

  async getCustomers(
    tenantId: string,
    query: StatisticsCustomersQueryDto,
  ): Promise<StatisticsCustomersDto> {
    const pagination = parsePaginationFromQuery(query);
    const { rows, timeZone, limitations } = await this.buildRows(tenantId, query);
    const page = rows.slice(
      (pagination.page - 1) * pagination.pageSize,
      pagination.page * pagination.pageSize,
    );
    return {
      timeZone,
      generatedAt: new Date(),
      limitations,
      data: page,
      meta: buildPaginationMeta(pagination.page, pagination.pageSize, rows.length),
    };
  }

  async getAllCustomers(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Promise<StatisticsCustomerRowDto[]> {
    const { rows } = await this.buildRows(tenantId, query);
    return rows;
  }

  private async buildRows(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Promise<{
    rows: StatisticsCustomerRowDto[];
    timeZone: string;
    limitations: string[];
  }> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const range = resolveStatisticsDateRange(
      { from: query.from, to: query.to },
      tenant?.timezone,
    );
    const limitations = new Set<string>([
      ...STATISTICS_CUSTOMER_LIMITATIONS,
      ...STATISTICS_FINANCE_LIMITATIONS,
    ]);
    const ops = await this.collectOps(tenantId, query, range);
    await this.collectFinance(tenantId, query, range, ops, limitations);
    const rows = Array.from(ops.values())
      .map((row) => this.toRow(row))
      .sort(
        (left, right) =>
          right.containerMovements - left.containerMovements ||
          left.customerName.localeCompare(right.customerName),
      );
    return { rows, timeZone: range.timeZone, limitations: Array.from(limitations) };
  }

  private async collectOps(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
    range: { gte: Date; lt: Date },
  ): Promise<Map<string, CustomerOps & { finance: Map<string, CustomerFinanceGroup> }>> {
    const customers = new Map<
      string,
      CustomerOps & { finance: Map<string, CustomerFinanceGroup> }
    >();
    const ensure = (customerId: string, customerName: string) => {
      const existing = customers.get(customerId);
      if (existing) return existing;
      const created = {
        customerId,
        customerName,
        jobs: new Set<string>(),
        completedJobs: new Set<string>(),
        containers: new Set<string>(),
        movements: 0,
        completedTrips: 0,
        cancelledTrips: 0,
        jobTypes: new Map<string, number>(),
        finance: new Map<string, CustomerFinanceGroup>(),
      };
      customers.set(customerId, created);
      return created;
    };

    const movements = await this.trucking.loadCompactMovements(
      tenantId,
      query,
      range,
    );
    for (const movement of movements) {
      const row = ensure(movement.customerId, movement.customerName);
      row.movements += 1;
      row.containers.add(movement.jobItemId);
      row.jobs.add(movement.jobId);
      row.jobTypes.set(
        movement.jobType,
        (row.jobTypes.get(movement.jobType) ?? 0) + 1,
      );
    }

    const tripScope = buildStatisticsTripScope(tenantId, query);
    const [completedTripRows, cancelledTripRows] = await Promise.all([
      this.prisma.trip.findMany({
        where: {
          ...tripScope,
          status: { in: [...COMPLETED_TRIP_STATUSES] },
          closedAt: { gte: range.gte, lt: range.lt },
        },
        select: {
          jobId: true,
          tripType: true,
          job: {
            select: {
              id: true,
              jobType: true,
              jobTypeAssignments: { select: { jobType: true } },
              customerCompanyId: true,
              customerCompany: { select: { name: true } },
            },
          },
        },
      }),
      this.prisma.trip.findMany({
        where: {
          ...tripScope,
          status: TripStatus.CANCELLED,
          updatedAt: { gte: range.gte, lt: range.lt },
        },
        select: {
          job: {
            select: {
              customerCompanyId: true,
              customerCompany: { select: { name: true } },
            },
          },
        },
      }),
    ]);

    for (const trip of completedTripRows as Array<{
      jobId: string | null;
      tripType: string | null;
      job: {
        id: string;
        jobType: JobType | null;
        jobTypeAssignments?: Array<{ jobType: JobType }>;
        customerCompanyId: string;
        customerCompany: { name: string };
      } | null;
    }>) {
      if (!trip.job) continue;
      const row = ensure(trip.job.customerCompanyId, trip.job.customerCompany.name);
      row.completedTrips += 1;
      row.jobs.add(trip.job.id);
      const membership =
        trip.job.jobTypeAssignments && trip.job.jobTypeAssignments.length > 0
          ? trip.job.jobTypeAssignments.map((a) => a.jobType)
          : trip.job.jobType
            ? [trip.job.jobType]
            : [];
      for (const t of membership) {
        if (!row.jobTypes.has(t)) {
          row.jobTypes.set(t, 0);
        }
      }
      // Trip-specific classification seeds membership presence; do not force singular.
      if (trip.tripType && !row.jobTypes.has(trip.tripType)) {
        row.jobTypes.set(trip.tripType, 0);
      }
    }
    for (const trip of cancelledTripRows as Array<{
      job: {
        customerCompanyId: string;
        customerCompany: { name: string };
      } | null;
    }>) {
      if (!trip.job) continue;
      ensure(trip.job.customerCompanyId, trip.job.customerCompany.name).cancelledTrips += 1;
    }

    return customers;
  }

  private async collectFinance(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
    range: { gte: Date; lt: Date },
    customers: Map<string, CustomerOps & { finance: Map<string, CustomerFinanceGroup> }>,
    limitations: Set<string>,
  ): Promise<void> {
    const payoutCurrency = normalizeCurrency(DEFAULT_PAYOUT_CURRENCY);
    let cursor: string | undefined;
    for (;;) {
      const jobs = (await this.prisma.job.findMany({
        where: {
          ...buildStatisticsJobScope(tenantId, query),
          trips: {
            some: {
              tenantId,
              status: { in: [...COMPLETED_TRIP_STATUSES] },
              closedAt: { gte: range.gte, lt: range.lt },
            },
          },
        },
        orderBy: { id: "asc" },
        take: CUSTOMER_JOB_BATCH,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          customerCompanyId: true,
          customerCompany: { select: { name: true } },
          status: true,
          invoiceReadyAt: true,
        },
      })) as Array<{
        id: string;
        customerCompanyId: string;
        customerCompany: { name: string };
        status: JobStatus;
        invoiceReadyAt: Date | null;
      }>;
      if (jobs.length === 0) break;
      const jobIds = jobs.map((job) => job.id);
      const [tripRows, chargeGroups, invoices] = await Promise.all([
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
        }),
        this.prisma.invoice.findMany({
          where: {
            tenantId,
            OR: [
              { sourceJobId: { in: jobIds } },
              { customerCompanyId: { in: jobs.map((job) => job.customerCompanyId) } },
            ],
          },
          select: {
            id: true,
            customerCompanyId: true,
            sourceJobId: true,
            currency: true,
            status: true,
            totalCents: true,
            issuedAt: true,
            sentAt: true,
            issueDate: true,
            paidAt: true,
          },
        }),
      ]);
      const completedTripIds = (
        tripRows as Array<{ id: string; status: TripStatus }>
      )
        .filter((trip) =>
          COMPLETED_TRIP_STATUSES.includes(
            trip.status as (typeof COMPLETED_TRIP_STATUSES)[number],
          ),
        )
        .map((trip) => trip.id);
      const payoutRows =
        completedTripIds.length > 0
          ? await this.prisma.tripPayoutLine.findMany({
              where: { tenantId, tripId: { in: completedTripIds } },
              select: {
                tripId: true,
                totalCents: true,
                amountCents: true,
                quantity: true,
                isSelectableForTripEarning: true,
              },
            })
          : [];
      const payoutByTrip = new Map<string, typeof payoutRows>();
      for (const line of payoutRows as Array<{ tripId: string }>) {
        const list = payoutByTrip.get(line.tripId) ?? [];
        list.push(line as never);
        payoutByTrip.set(line.tripId, list);
      }
      const tripsByJob = new Map<string, Array<{
        id: string;
        jobId: string | null;
        status: TripStatus;
        closedAt: Date | null;
        driverEarningCents: number | null;
        payoutLines: typeof payoutRows;
      }>>();
      for (const trip of tripRows as Array<{
        id: string;
        jobId: string | null;
        status: TripStatus;
        closedAt: Date | null;
        driverEarningCents: number | null;
      }>) {
        if (!trip.jobId) continue;
        const list = tripsByJob.get(trip.jobId) ?? [];
        list.push({
          ...trip,
          payoutLines: payoutByTrip.get(trip.id) ?? [],
        });
        tripsByJob.set(trip.jobId, list);
      }
      const chargesByJob = new Map<string, Array<{ currency: string; amountCents: number }>>();
      for (const charge of chargeGroups as Array<{
        jobId: string;
        currency: string;
        _sum: { amountCents: number | null };
      }>) {
        const list = chargesByJob.get(charge.jobId) ?? [];
        try {
          list.push({
            currency: normalizeCurrency(charge.currency),
            amountCents: safeInteger(charge._sum.amountCents),
          });
        } catch {
          limitations.add(STATISTICS_FINANCE_DYNAMIC_LIMITATIONS.INVALID_CURRENCY);
          continue;
        }
        chargesByJob.set(charge.jobId, list);
      }

      for (const job of jobs) {
        const row = customers.get(job.customerCompanyId) ?? {
          customerId: job.customerCompanyId,
          customerName: job.customerCompany.name,
          jobs: new Set<string>([job.id]),
          completedJobs: new Set<string>(),
          containers: new Set<string>(),
          movements: 0,
          completedTrips: 0,
          cancelledTrips: 0,
          jobTypes: new Map<string, number>(),
          finance: new Map<string, CustomerFinanceGroup>(),
        };
        customers.set(job.customerCompanyId, row);
        row.jobs.add(job.id);
        const jobTrips = tripsByJob.get(job.id) ?? [];
        if (isOperationallyCompletedJob(jobTrips)) {
          const reporting = jobTrips
            .filter((trip) => trip.status !== TripStatus.CANCELLED)
            .map((trip) => completedTripReportingTimestamp(trip))
            .filter((date): date is Date => date instanceof Date);
          if (reporting.length > 0) {
            const timestamp = new Date(Math.max(...reporting.map((date) => date.getTime())));
            if (timestamp >= range.gte && timestamp < range.lt) {
              row.completedJobs.add(job.id);
              const charges = chargesByJob.get(job.id) ?? [];
              for (const charge of charges) {
                const group = this.ensureFinance(row.finance, charge.currency);
                group.jobChargesCents = safeAdd(group.jobChargesCents, charge.amountCents);
              }
              for (const trip of jobTrips) {
                if (
                  !COMPLETED_TRIP_STATUSES.includes(
                    trip.status as (typeof COMPLETED_TRIP_STATUSES)[number],
                  )
                ) {
                  continue;
                }
                const payout = resolveCompletedTripPayoutState(trip);
                if (payout?.kind === "recorded") {
                  const group = this.ensureFinance(row.finance, payoutCurrency);
                  group.recordedDriverPayoutCents = safeAdd(
                    group.recordedDriverPayoutCents,
                    payout.totalCents,
                  );
                }
              }
              const eligibility = evaluateGrossProfitEligibility({
                trips: jobTrips,
                charges,
                payoutCurrency,
              });
              if (eligibility.eligible) {
                const group = this.ensureFinance(row.finance, eligibility.currency);
                group.grossProfitCents = safeAdd(
                  group.grossProfitCents,
                  eligibility.grossProfitCents,
                );
                group.eligibleRevenueCents = safeAdd(
                  group.eligibleRevenueCents,
                  eligibility.revenueCents,
                );
                group.hasEligibleProfit = true;
              } else if (
                "reason" in eligibility &&
                (eligibility.reason === "multiple_revenue_currencies" ||
                  eligibility.reason === "revenue_payout_currency_mismatch")
              ) {
                limitations.add(
                  STATISTICS_FINANCE_DYNAMIC_LIMITATIONS.PROFIT_CURRENCY_MISMATCH,
                );
                for (const group of row.finance.values()) {
                  group.profitUnavailable = true;
                  group.hasEligibleProfit = false;
                }
              }
            }
          }
        }

        if (
          job.status === JobStatus.READY_FOR_INVOICE &&
          job.invoiceReadyAt &&
          job.invoiceReadyAt >= range.gte &&
          job.invoiceReadyAt < range.lt
        ) {
          const hasRecognizedInvoice = (
            invoices as Array<{ sourceJobId: string | null; status: string }>
          ).some(
            (invoice) =>
              invoice.sourceJobId === job.id &&
              RECOGNIZED_INVOICE_STATUSES.includes(invoice.status as never),
          );
          if (!hasRecognizedInvoice) {
            for (const charge of chargesByJob.get(job.id) ?? []) {
              const group = this.ensureFinance(row.finance, charge.currency);
              group.uninvoicedReadyValueCents = safeAdd(
                group.uninvoicedReadyValueCents,
                charge.amountCents,
              );
            }
          }
        }
      }

      for (const invoice of invoices as Array<{
        customerCompanyId: string | null;
        sourceJobId: string | null;
        currency: string;
        status: string;
        totalCents: number;
        issuedAt: Date | null;
        sentAt: Date | null;
        issueDate: Date;
        paidAt: Date | null;
      }>) {
        const customerId =
          invoice.customerCompanyId ??
          jobs.find((job) => job.id === invoice.sourceJobId)?.customerCompanyId;
        if (!customerId) continue;
        const row = customers.get(customerId);
        if (!row) continue;
        let currency: string;
        try {
          currency = normalizeCurrency(invoice.currency);
        } catch {
          limitations.add(STATISTICS_FINANCE_DYNAMIC_LIMITATIONS.INVALID_CURRENCY);
          continue;
        }
        const group = this.ensureFinance(row.finance, currency);
        const issuedAt = invoice.issuedAt ?? invoice.sentAt ?? invoice.issueDate;
        if (
          RECOGNIZED_INVOICE_STATUSES.includes(invoice.status as never) &&
          issuedAt >= range.gte &&
          issuedAt < range.lt
        ) {
          group.issuedInvoiceValueCents = safeAdd(
            group.issuedInvoiceValueCents,
            safeInteger(invoice.totalCents),
          );
        }
        if (
          invoice.status === "Paid" &&
          invoice.paidAt &&
          invoice.paidAt >= range.gte &&
          invoice.paidAt < range.lt
        ) {
          group.paidInvoiceValueCents = safeAdd(
            group.paidInvoiceValueCents,
            safeInteger(invoice.totalCents),
          );
        }
      }

      cursor = jobs[jobs.length - 1].id;
      if (jobs.length < CUSTOMER_JOB_BATCH) break;
    }
  }

  private ensureFinance(
    groups: Map<string, CustomerFinanceGroup>,
    currency: string,
  ): CustomerFinanceGroup {
    const existing = groups.get(currency);
    if (existing) return existing;
    const created: CustomerFinanceGroup = {
      currency,
      jobChargesCents: 0,
      issuedInvoiceValueCents: 0,
      paidInvoiceValueCents: 0,
      uninvoicedReadyValueCents: 0,
      recordedDriverPayoutCents: 0,
      grossProfitCents: 0,
      eligibleRevenueCents: 0,
      hasEligibleProfit: false,
      profitUnavailable: false,
    };
    groups.set(currency, created);
    return created;
  }

  private toRow(
    row: CustomerOps & { finance: Map<string, CustomerFinanceGroup> },
  ): StatisticsCustomerRowDto {
    const currencyGroups: StatisticsCustomerCurrencyGroupDto[] = Array.from(
      row.finance.values(),
    )
      .sort((left, right) => left.currency.localeCompare(right.currency))
      .map((group) => ({
        currency: group.currency,
        jobChargesCents: group.jobChargesCents,
        issuedInvoiceValueCents: group.issuedInvoiceValueCents,
        paidInvoiceValueCents: group.paidInvoiceValueCents,
        uninvoicedReadyValueCents: group.uninvoicedReadyValueCents,
        recordedDriverPayoutCents: group.recordedDriverPayoutCents,
        grossProfitCents:
          group.profitUnavailable || !group.hasEligibleProfit
            ? null
            : group.grossProfitCents,
        grossMarginBasisPoints:
          group.profitUnavailable || !group.hasEligibleProfit
            ? null
            : grossMarginBasisPoints(
                group.grossProfitCents,
                group.eligibleRevenueCents,
              ),
      }));
    const jobTypeMix = Array.from(row.jobTypes.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([type, count]) => `${type} ${count}`)
      .join(", ");
    return {
      customerName: row.customerName,
      jobs: row.jobs.size,
      completedJobs: row.completedJobs.size,
      uniqueContainers: row.containers.size,
      containerMovements: row.movements,
      completedTrips: row.completedTrips,
      cancelledTrips: row.cancelledTrips,
      averageMovementsPerContainer:
        row.containers.size > 0
          ? Math.round((row.movements / row.containers.size) * 100) / 100
          : null,
      jobTypeMix: jobTypeMix || "—",
      currencyGroups,
      profitAggregationAvailable:
        currencyGroups.length <= 1 &&
        currencyGroups.every((group) => group.grossProfitCents != null),
    };
  }
}
