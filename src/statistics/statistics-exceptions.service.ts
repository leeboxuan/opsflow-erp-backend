import { Injectable } from "@nestjs/common";
import {
  JobStatus,
  Prisma,
  TripDocumentType,
  TripStatus,
} from "@prisma/client";
import {
  buildPaginationMeta,
  parsePaginationFromQuery,
} from "../shared/common/pagination";
import { PrismaService } from "../shared/prisma/prisma.service";
import {
  StatisticsExceptionItemDto,
  StatisticsExceptionsDto,
  StatisticsExceptionsQueryDto,
} from "./dto";
import {
  ACTIVE_TRIP_STATUSES,
  COMPLETED_TRIP_STATUSES,
  DEFAULT_PAYOUT_CURRENCY,
  RECOGNIZED_INVOICE_STATUSES,
  STATISTICS_EXCEPTION_DEFINITIONS,
  STATISTICS_EXCEPTION_KEYS,
  STATISTICS_EXCEPTION_LIMITATIONS,
  STATISTICS_EXCEPTION_SEVERITY_RANK,
  StatisticsExceptionKey,
} from "./statistics.constants";
import { resolveStatisticsDateRange } from "./statistics-date-range";
import {
  completedTripReportingTimestamp,
  evaluateGrossProfitEligibility,
  evaluateRequiredDocumentCompletion,
  hasResolvableRequiredDocumentRule,
  isInvalidCompletedTripTimestamp,
  isOperationallyCompletedJob,
  isOrphanInvoiceJobLink,
  isStaleOperationalTrip,
  resolveCompletedTripPayoutState,
} from "./statistics.predicates";

const EXCEPTION_BATCH_SIZE = 200;

type ExceptionTrip = {
  id: string;
  jobId: string | null;
  status: TripStatus;
  startedAt: Date | null;
  closedAt: Date | null;
  plannedStartAt: Date | null;
  updatedAt: Date;
  completionRuleJson: Prisma.JsonValue | null;
};

type ExceptionPayoutLine = {
  tripId: string;
  totalCents: number | null;
  amountCents: number | null;
  quantity: number;
  isSelectableForTripEarning: boolean;
};

type ExceptionDocument = {
  tripId: string;
  type: TripDocumentType;
  isActive: boolean;
  generatedBySystem: boolean;
  isSigned: boolean;
  signedAt: Date | null;
};

type ExceptionChargeGroup = {
  jobId: string;
  currency: string;
  _sum: { amountCents: number | null };
};

type ExceptionInvoice = {
  id: string;
  sourceJobId: string | null;
  snapshot: Prisma.JsonValue | null;
  issuedAt: Date | null;
  sentAt: Date | null;
  issueDate: Date;
};

type ExceptionSortField = "severity" | "reportingTimestamp" | "key";
type ExceptionSortDirection = "asc" | "desc";

function exceptionIdentity(row: StatisticsExceptionItemDto): string {
  return `${row.key}:${row.entityType}:${row.entityId}`;
}

export function compareExceptions(
  left: StatisticsExceptionItemDto,
  right: StatisticsExceptionItemDto,
  sortBy: ExceptionSortField,
  sortDir: ExceptionSortDirection,
): number {
  let comparison = 0;
  if (sortBy === "severity") {
    comparison =
      STATISTICS_EXCEPTION_SEVERITY_RANK[left.severity] -
      STATISTICS_EXCEPTION_SEVERITY_RANK[right.severity];
  } else if (sortBy === "key") {
    comparison = left.key.localeCompare(right.key);
  } else {
    const leftTime = left.reportingTimestamp?.getTime() ?? null;
    const rightTime = right.reportingTimestamp?.getTime() ?? null;
    if (leftTime == null || rightTime == null) {
      if (leftTime == null && rightTime != null) return 1;
      if (leftTime != null && rightTime == null) return -1;
    } else {
      comparison = leftTime - rightTime;
    }
  }
  if (comparison !== 0) {
    return sortDir === "asc" ? comparison : -comparison;
  }
  return exceptionIdentity(left).localeCompare(exceptionIdentity(right));
}

class BoundedExceptionCollector {
  private readonly rows: StatisticsExceptionItemDto[] = [];
  private readonly counts = new Map<StatisticsExceptionKey, number>(
    STATISTICS_EXCEPTION_KEYS.map((key) => [key, 0]),
  );
  private total = 0;

  constructor(
    private readonly limit: number,
    private readonly sortBy: ExceptionSortField,
    private readonly sortDir: ExceptionSortDirection,
  ) {}

  add(row: StatisticsExceptionItemDto): void {
    this.total += 1;
    this.counts.set(row.key, (this.counts.get(row.key) ?? 0) + 1);
    if (this.limit === 0) return;
    this.rows.push(row);
    this.rows.sort((left, right) =>
      compareExceptions(left, right, this.sortBy, this.sortDir),
    );
    if (this.rows.length > this.limit) this.rows.pop();
  }

  result(skip: number, take: number) {
    return {
      data: this.rows.slice(skip, skip + take),
      total: this.total,
      countsByKey: STATISTICS_EXCEPTION_KEYS.map((key) => ({
        key,
        count: this.counts.get(key) ?? 0,
      })),
    };
  }
}

@Injectable()
export class StatisticsExceptionsService {
  constructor(private readonly prisma: PrismaService) {}

  async getExceptions(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
  ): Promise<StatisticsExceptionsDto> {
    const pagination = parsePaginationFromQuery(query);
    return this.collectExceptions(
      tenantId,
      query,
      pagination.skip,
      pagination.take,
      pagination.skip + pagination.take,
      pagination.page,
      pagination.pageSize,
    );
  }

  /**
   * Internal bounded export projection. It scans each existing category once,
   * retains at most maxRows + 1 sorted rows, and still computes the exact total.
   */
  async getExceptionsForExport(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    maxRows: number,
  ): Promise<StatisticsExceptionsDto> {
    const take = maxRows + 1;
    return this.collectExceptions(tenantId, query, 0, take, take, 1, take);
  }

  private async collectExceptions(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    skip: number,
    take: number,
    collectorLimit: number,
    page: number,
    pageSize: number,
  ): Promise<StatisticsExceptionsDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const now = new Date();
    const range = resolveStatisticsDateRange(
      { from: query.from, to: query.to },
      tenant?.timezone,
      now,
    );
    const sortBy: ExceptionSortField =
      query.sortBy === "reportingTimestamp" || query.sortBy === "key"
        ? query.sortBy
        : "severity";
    const sortDir: ExceptionSortDirection =
      query.sortDir === "asc" ? "asc" : "desc";
    const collector = new BoundedExceptionCollector(
      collectorLimit,
      sortBy,
      sortDir,
    );

    await this.scanCompletedTripExceptions(tenantId, query, range, collector);
    await this.scanClosedAtNullTimestampExceptions(tenantId, query, collector);
    await this.scanStaleTrips(tenantId, query, now, collector);
    await this.scanCancelledTrips(tenantId, query, range, collector);
    await this.scanReadyNotInvoiced(tenantId, query, range, collector);
    await this.scanJobFinancialExceptions(tenantId, query, range, collector);
    await this.scanOrphanInvoices(tenantId, query, range, collector);

    const result = collector.result(skip, take);
    await this.hydrateExceptionReferences(tenantId, result.data);
    return {
      data: result.data,
      meta: buildPaginationMeta(page, pageSize, result.total),
      countsByKey: result.countsByKey,
      timeZone: range.timeZone,
      generatedAt: now,
      limitations: [...STATISTICS_EXCEPTION_LIMITATIONS],
    };
  }

  private shouldScan(
    key: StatisticsExceptionKey,
    query: StatisticsExceptionsQueryDto,
  ): boolean {
    const definition = STATISTICS_EXCEPTION_DEFINITIONS[key];
    return (
      (!query.key || query.key === key) &&
      (!query.severity || query.severity === definition.severity)
    );
  }

  private async scanCompletedTripExceptions(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    range: { gte: Date; lt: Date },
    collector: BoundedExceptionCollector,
  ): Promise<void> {
    const scanPayout = this.shouldScan("ex_trip_missing_payout", query);
    const scanDocuments = this.shouldScan(
      "ex_trip_missing_required_docs",
      query,
    );
    const scanTimestamps = this.shouldScan("ex_invalid_timestamps", query);
    if (!scanPayout && !scanDocuments && !scanTimestamps) return;

    let cursor: string | undefined;
    for (;;) {
      const trips = (await this.prisma.trip.findMany({
        where: {
          ...this.buildTripScope(tenantId, query),
          status: { in: [...COMPLETED_TRIP_STATUSES] },
          closedAt: { gte: range.gte, lt: range.lt },
        },
        orderBy: { id: "asc" },
        take: EXCEPTION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          jobId: true,
          status: true,
          startedAt: true,
          closedAt: true,
          plannedStartAt: true,
          updatedAt: true,
          completionRuleJson: true,
        },
      })) as ExceptionTrip[];
      if (trips.length === 0) break;
      const tripIds = trips.map((trip) => trip.id);
      const [payoutRows, documentRows] = await Promise.all([
        scanPayout
          ? this.prisma.tripPayoutLine.findMany({
              where: { tenantId, tripId: { in: tripIds } },
              select: {
                tripId: true,
                totalCents: true,
                amountCents: true,
                quantity: true,
                isSelectableForTripEarning: true,
              },
            })
          : Promise.resolve([]),
        scanDocuments
          ? this.prisma.tripDocument.findMany({
              where: {
                tenantId,
                tripId: { in: tripIds },
                isActive: true,
              },
              select: {
                tripId: true,
                type: true,
                isActive: true,
                generatedBySystem: true,
                isSigned: true,
                signedAt: true,
              },
            })
          : Promise.resolve([]),
      ]);
      const payoutsByTrip = this.groupByTripId<ExceptionPayoutLine>(
        payoutRows as ExceptionPayoutLine[],
      );
      const documentsByTrip = this.groupByTripId<ExceptionDocument>(
        documentRows as ExceptionDocument[],
      );

      for (const trip of trips) {
        if (
          scanPayout &&
          resolveCompletedTripPayoutState({
            ...trip,
            payoutLines: payoutsByTrip.get(trip.id) ?? [],
          })?.kind === "missing"
        ) {
          collector.add(
            this.tripRow("ex_trip_missing_payout", trip, trip.closedAt),
          );
        }
        if (
          scanDocuments &&
          hasResolvableRequiredDocumentRule(trip.completionRuleJson) &&
          !evaluateRequiredDocumentCompletion(
            trip.completionRuleJson,
            documentsByTrip.get(trip.id) ?? [],
          ).complete
        ) {
          collector.add(
            this.tripRow("ex_trip_missing_required_docs", trip, trip.closedAt),
          );
        }
        if (scanTimestamps && isInvalidCompletedTripTimestamp(trip)) {
          collector.add(
            this.tripRow("ex_invalid_timestamps", trip, trip.closedAt),
          );
        }
      }
      cursor = trips[trips.length - 1].id;
      if (trips.length < EXCEPTION_BATCH_SIZE) break;
    }
  }

  private async scanClosedAtNullTimestampExceptions(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    collector: BoundedExceptionCollector,
  ): Promise<void> {
    if (!this.shouldScan("ex_invalid_timestamps", query)) return;
    await this.scanTrips(
      {
        ...this.buildTripScope(tenantId, query),
        status: { in: [...COMPLETED_TRIP_STATUSES] },
        closedAt: null,
      },
      async (trip) => {
        if (isInvalidCompletedTripTimestamp(trip)) {
          collector.add(this.tripRow("ex_invalid_timestamps", trip, null));
        }
      },
    );
  }

  private async scanStaleTrips(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    now: Date,
    collector: BoundedExceptionCollector,
  ): Promise<void> {
    if (!this.shouldScan("ex_stale_operational_work", query)) return;
    await this.scanTrips(
      {
        ...this.buildTripScope(tenantId, query),
        status: { in: [...ACTIVE_TRIP_STATUSES] },
      },
      async (trip) => {
        if (isStaleOperationalTrip(trip, now)) {
          collector.add(this.tripRow("ex_stale_operational_work", trip, null));
        }
      },
    );
  }

  private async scanCancelledTrips(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    range: { gte: Date; lt: Date },
    collector: BoundedExceptionCollector,
  ): Promise<void> {
    if (!this.shouldScan("ex_cancelled_trip", query)) return;
    await this.scanTrips(
      {
        ...this.buildTripScope(tenantId, query),
        status: TripStatus.CANCELLED,
        updatedAt: { gte: range.gte, lt: range.lt },
      },
      async (trip) => {
        collector.add(this.tripRow("ex_cancelled_trip", trip, trip.updatedAt));
      },
    );
  }

  private async scanReadyNotInvoiced(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    range: { gte: Date; lt: Date },
    collector: BoundedExceptionCollector,
  ): Promise<void> {
    if (!this.shouldScan("ex_ready_not_invoiced", query)) return;
    let cursor: string | undefined;
    for (;;) {
      const jobs = (await this.prisma.job.findMany({
        where: {
          ...this.buildJobScope(tenantId, query),
          status: JobStatus.READY_FOR_INVOICE,
          invoiceReadyAt: { gte: range.gte, lt: range.lt },
        },
        orderBy: { id: "asc" },
        take: EXCEPTION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true, invoiceReadyAt: true },
      })) as Array<{
        id: string;
        invoiceReadyAt: Date | null;
      }>;
      if (jobs.length === 0) break;
      const jobIds = jobs.map((job) => job.id);
      const invoices = (await this.prisma.invoice.findMany({
        where: {
          tenantId,
          sourceJobId: { in: jobIds },
          status: { in: [...RECOGNIZED_INVOICE_STATUSES] },
        },
        select: { sourceJobId: true },
      })) as Array<{ sourceJobId: string | null }>;
      const invoiced = new Set(
        invoices
          .map((invoice) => invoice.sourceJobId)
          .filter((jobId): jobId is string => typeof jobId === "string"),
      );
      for (const job of jobs) {
        if (!invoiced.has(job.id)) {
          collector.add(
            this.jobRow("ex_ready_not_invoiced", job.id, job.invoiceReadyAt),
          );
        }
      }
      cursor = jobs[jobs.length - 1].id;
      if (jobs.length < EXCEPTION_BATCH_SIZE) break;
    }
  }

  private async scanJobFinancialExceptions(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    range: { gte: Date; lt: Date },
    collector: BoundedExceptionCollector,
  ): Promise<void> {
    const scanMissingCharges = this.shouldScan("ex_job_missing_charges", query);
    const scanExcludedProfit = this.shouldScan(
      "ex_excluded_from_profit",
      query,
    );
    if (!scanMissingCharges && !scanExcludedProfit) return;

    let cursor: string | undefined;
    for (;;) {
      const jobs = (await this.prisma.job.findMany({
        where: {
          AND: [
            this.buildJobScope(tenantId, query),
            { status: { not: JobStatus.CANCELLED } },
            {
              trips: {
                some: {
                  tenantId,
                  status: {
                    in: [...COMPLETED_TRIP_STATUSES],
                  },
                  closedAt: {
                    gte: range.gte,
                    lt: range.lt,
                  },
                },
              },
            },
          ],
        },
        orderBy: { id: "asc" },
        take: EXCEPTION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      })) as Array<{ id: string }>;
      if (jobs.length === 0) break;
      const jobIds = jobs.map((job) => job.id);
      const [tripRows, chargeRows] = await Promise.all([
        this.prisma.trip.findMany({
          where: { tenantId, jobId: { in: jobIds } },
          select: {
            id: true,
            jobId: true,
            status: true,
            startedAt: true,
            closedAt: true,
            plannedStartAt: true,
            updatedAt: true,
            completionRuleJson: true,
          },
        }),
        this.prisma.jobCharge.groupBy({
          by: ["jobId", "currency"],
          where: { tenantId, jobId: { in: jobIds } },
          _sum: { amountCents: true },
        }),
      ]);
      const trips = tripRows as ExceptionTrip[];
      const completedTripIds = trips
        .filter((trip) =>
          COMPLETED_TRIP_STATUSES.includes(
            trip.status as (typeof COMPLETED_TRIP_STATUSES)[number],
          ),
        )
        .map((trip) => trip.id);
      const payoutRows =
        scanExcludedProfit && completedTripIds.length > 0
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
            })) as ExceptionPayoutLine[])
          : [];
      const payoutsByTrip = this.groupByTripId<ExceptionPayoutLine>(payoutRows);
      const tripsByJob = new Map<string, ExceptionTrip[]>();
      for (const trip of trips) {
        if (!trip.jobId) continue;
        const rows = tripsByJob.get(trip.jobId) ?? [];
        rows.push({
          ...trip,
          payoutLines: payoutsByTrip.get(trip.id) ?? [],
        } as ExceptionTrip);
        tripsByJob.set(trip.jobId, rows);
      }
      const chargesByJob = new Map<string, ExceptionChargeGroup[]>();
      for (const charge of chargeRows as ExceptionChargeGroup[]) {
        const rows = chargesByJob.get(charge.jobId) ?? [];
        rows.push(charge);
        chargesByJob.set(charge.jobId, rows);
      }

      for (const job of jobs) {
        const jobTrips = tripsByJob.get(job.id) ?? [];
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
        const charges = chargesByJob.get(job.id) ?? [];
        if (scanMissingCharges && charges.length === 0) {
          collector.add(
            this.jobRow("ex_job_missing_charges", job.id, reportingTimestamp),
          );
        }
        if (scanExcludedProfit) {
          let eligible = false;
          try {
            eligible = evaluateGrossProfitEligibility({
              trips: jobTrips as Array<
                ExceptionTrip & {
                  payoutLines: ExceptionPayoutLine[];
                }
              >,
              charges: charges.map((charge) => ({
                currency: charge.currency,
                amountCents: charge._sum.amountCents ?? 0,
              })),
              payoutCurrency: DEFAULT_PAYOUT_CURRENCY,
            }).eligible;
          } catch {
            eligible = false;
          }
          if (!eligible) {
            collector.add(
              this.jobRow(
                "ex_excluded_from_profit",
                job.id,
                reportingTimestamp,
              ),
            );
          }
        }
      }
      cursor = jobs[jobs.length - 1].id;
      if (jobs.length < EXCEPTION_BATCH_SIZE) break;
    }
  }

  private async scanOrphanInvoices(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    range: { gte: Date; lt: Date },
    collector: BoundedExceptionCollector,
  ): Promise<void> {
    if (!this.shouldScan("ex_orphan_invoice_job_link", query)) return;
    const hasEntityFilter = Boolean(
      query.customerId ||
      query.jobId ||
      query.tripId ||
      query.driverId ||
      query.vehicleId,
    );
    if (!hasEntityFilter) {
      await this.scanInvoiceBatchSet(tenantId, range, collector);
      return;
    }
    await this.forEachFilteredJobIdBatch(tenantId, query, async (jobIds) => {
      const trips = (await this.prisma.trip.findMany({
        where: {
          ...this.buildTripScope(tenantId, query),
          jobId: { in: jobIds },
        },
        select: { id: true },
      })) as Array<{ id: string }>;
      await this.scanInvoiceBatchSet(
        tenantId,
        range,
        collector,
        jobIds,
        trips.map((trip) => trip.id),
      );
    });
  }

  private async scanInvoiceBatchSet(
    tenantId: string,
    range: { gte: Date; lt: Date },
    collector: BoundedExceptionCollector,
    sourceJobIds?: string[],
    filterTripIds?: string[],
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const entityScope =
        sourceJobIds === undefined
          ? {}
          : {
              OR: [
                { sourceJobId: { in: sourceJobIds } },
                ...(filterTripIds && filterTripIds.length > 0
                  ? [
                      {
                        sourceJobId: null,
                        lineItems: {
                          some: {
                            tenantId,
                            sourceTripId: {
                              in: filterTripIds,
                            },
                          },
                        },
                      },
                    ]
                  : []),
              ],
            };
      const invoices = (await this.prisma.invoice.findMany({
        where: {
          tenantId,
          status: { in: [...RECOGNIZED_INVOICE_STATUSES] },
          ...entityScope,
          AND: [
            {
              OR: [
                {
                  issuedAt: {
                    gte: range.gte,
                    lt: range.lt,
                  },
                },
                {
                  issuedAt: null,
                  sentAt: { gte: range.gte, lt: range.lt },
                },
                {
                  issuedAt: null,
                  sentAt: null,
                  issueDate: {
                    gte: range.gte,
                    lt: range.lt,
                  },
                },
              ],
            },
          ],
        },
        orderBy: { id: "asc" },
        take: EXCEPTION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          sourceJobId: true,
          snapshot: true,
          issuedAt: true,
          sentAt: true,
          issueDate: true,
        },
      })) as ExceptionInvoice[];
      if (invoices.length === 0) break;
      const invoiceIds = invoices.map((invoice) => invoice.id);
      const lineItems = (await this.prisma.invoiceLineItem.findMany({
        where: {
          tenantId,
          invoiceId: { in: invoiceIds },
          sourceTripId: { not: null },
        },
        select: {
          invoiceId: true,
          sourceTripId: true,
        },
      })) as Array<{
        invoiceId: string;
        sourceTripId: string | null;
      }>;
      const sourceTripIds = lineItems
        .map((line) => line.sourceTripId)
        .filter((tripId): tripId is string => typeof tripId === "string");
      const sourceJobs = new Set(
        (
          (await this.prisma.job.findMany({
            where: {
              tenantId,
              id: {
                in: invoices
                  .map((invoice) => invoice.sourceJobId)
                  .filter(
                    (jobId): jobId is string => typeof jobId === "string",
                  ),
              },
            },
            select: { id: true },
          })) as Array<{ id: string }>
        ).map((job) => job.id),
      );
      const sourceTrips =
        sourceTripIds.length > 0
          ? ((await this.prisma.trip.findMany({
              where: {
                tenantId,
                id: { in: sourceTripIds },
              },
              select: { id: true, jobId: true },
            })) as Array<{
              id: string;
              jobId: string | null;
            }>)
          : [];
      const tripJobById = new Map(
        sourceTrips.map((trip) => [trip.id, trip.jobId] as const),
      );
      const linesByInvoice = new Map<string, Array<string | null>>();
      for (const line of lineItems) {
        const rows = linesByInvoice.get(line.invoiceId) ?? [];
        rows.push(
          line.sourceTripId
            ? (tripJobById.get(line.sourceTripId) ?? null)
            : null,
        );
        linesByInvoice.set(line.invoiceId, rows);
      }

      for (const invoice of invoices) {
        if (
          isOrphanInvoiceJobLink({
            sourceJobId: invoice.sourceJobId,
            sourceJobExistsInTenant:
              !!invoice.sourceJobId && sourceJobs.has(invoice.sourceJobId),
            snapshotSourceJobIds: this.snapshotSourceJobIds(invoice.snapshot),
            lineSourceJobIds: linesByInvoice.get(invoice.id) ?? [],
          })
        ) {
          collector.add(
            this.invoiceRow(
              invoice.id,
              invoice.issuedAt ?? invoice.sentAt ?? invoice.issueDate,
            ),
          );
        }
      }
      cursor = invoices[invoices.length - 1].id;
      if (invoices.length < EXCEPTION_BATCH_SIZE) break;
    }
  }

  private async scanTrips(
    where: Prisma.TripWhereInput,
    visit: (trip: ExceptionTrip) => Promise<void>,
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const trips = (await this.prisma.trip.findMany({
        where,
        orderBy: { id: "asc" },
        take: EXCEPTION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          jobId: true,
          status: true,
          startedAt: true,
          closedAt: true,
          plannedStartAt: true,
          updatedAt: true,
          completionRuleJson: true,
        },
      })) as ExceptionTrip[];
      if (trips.length === 0) break;
      for (const trip of trips) await visit(trip);
      cursor = trips[trips.length - 1].id;
      if (trips.length < EXCEPTION_BATCH_SIZE) break;
    }
  }

  private buildTripScope(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
  ): Prisma.TripWhereInput {
    return {
      tenantId,
      jobId: query.jobId ?? { not: null },
      ...(query.tripId ? { id: query.tripId } : {}),
      ...(query.driverId ? { assignedDriverUserId: query.driverId } : {}),
      ...(query.vehicleId
        ? {
            OR: [
              { vehicleId: query.vehicleId },
              { fleetVehicleId: query.vehicleId },
            ],
          }
        : {}),
      job: {
        is: {
          tenantId,
          ...(query.customerId ? { customerCompanyId: query.customerId } : {}),
        },
      },
    };
  }

  private buildJobScope(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
  ): Prisma.JobWhereInput {
    const matchingTrip =
      query.tripId || query.driverId || query.vehicleId
        ? {
            tenantId,
            ...(query.tripId ? { id: query.tripId } : {}),
            ...(query.driverId ? { assignedDriverUserId: query.driverId } : {}),
            ...(query.vehicleId
              ? {
                  OR: [
                    { vehicleId: query.vehicleId },
                    { fleetVehicleId: query.vehicleId },
                  ],
                }
              : {}),
          }
        : null;
    return {
      tenantId,
      ...(query.jobId ? { id: query.jobId } : {}),
      ...(query.customerId ? { customerCompanyId: query.customerId } : {}),
      ...(matchingTrip ? { trips: { some: matchingTrip } } : {}),
    };
  }

  private async forEachFilteredJobIdBatch(
    tenantId: string,
    query: StatisticsExceptionsQueryDto,
    callback: (jobIds: string[]) => Promise<void>,
  ): Promise<void> {
    let cursor: string | undefined;
    for (;;) {
      const jobs = (await this.prisma.job.findMany({
        where: this.buildJobScope(tenantId, query),
        orderBy: { id: "asc" },
        take: EXCEPTION_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: { id: true },
      })) as Array<{ id: string }>;
      if (jobs.length === 0) break;
      await callback(jobs.map((job) => job.id));
      cursor = jobs[jobs.length - 1].id;
      if (jobs.length < EXCEPTION_BATCH_SIZE) break;
    }
  }

  private operationalJobReportingTimestamp(
    trips: ExceptionTrip[],
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

  private groupByTripId<T extends { tripId: string }>(
    rows: T[],
  ): Map<string, T[]> {
    const result = new Map<string, T[]>();
    for (const row of rows) {
      const values = result.get(row.tripId) ?? [];
      values.push(row);
      result.set(row.tripId, values);
    }
    return result;
  }

  private snapshotSourceJobIds(snapshot: Prisma.JsonValue | null): string[] {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      return [];
    }
    const value = (snapshot as Record<string, unknown>).sourceJobIds;
    if (!Array.isArray(value)) return [];
    return Array.from(
      new Set(
        value
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }

  private tripRow(
    key: StatisticsExceptionKey,
    trip: Pick<ExceptionTrip, "id" | "jobId">,
    reportingTimestamp: Date | null,
  ): StatisticsExceptionItemDto {
    return this.buildRow(key, {
      entityId: trip.id,
      jobId: trip.jobId,
      tripId: trip.id,
      invoiceId: null,
      reportingTimestamp,
      href: trip.jobId
        ? key === "ex_cancelled_trip"
          ? `/jobs/${trip.jobId}`
          : `/jobs/${trip.jobId}/workspace?tripId=${trip.id}`
        : `/trips/${trip.id}`,
    });
  }

  private jobRow(
    key: StatisticsExceptionKey,
    jobId: string,
    reportingTimestamp: Date | null,
  ): StatisticsExceptionItemDto {
    return this.buildRow(key, {
      entityId: jobId,
      jobId,
      tripId: null,
      invoiceId: null,
      reportingTimestamp,
      href:
        key === "ex_ready_not_invoiced"
          ? `/invoices/create?jobId=${jobId}`
          : `/jobs/${jobId}`,
    });
  }

  private invoiceRow(
    invoiceId: string,
    reportingTimestamp: Date,
  ): StatisticsExceptionItemDto {
    return this.buildRow("ex_orphan_invoice_job_link", {
      entityId: invoiceId,
      jobId: null,
      tripId: null,
      invoiceId,
      reportingTimestamp,
      href: `/invoices/${invoiceId}/edit`,
    });
  }

  private buildRow(
    key: StatisticsExceptionKey,
    input: {
      entityId: string;
      jobId: string | null;
      tripId: string | null;
      invoiceId: string | null;
      reportingTimestamp: Date | null;
      href: string;
    },
  ): StatisticsExceptionItemDto {
    const definition = STATISTICS_EXCEPTION_DEFINITIONS[key];
    return {
      key,
      severity: definition.severity,
      entityType: definition.entityType,
      entityId: input.entityId,
      jobId: input.jobId,
      tripId: input.tripId,
      invoiceId: input.invoiceId,
      reportingTimestamp: input.reportingTimestamp,
      explanation: definition.explanation,
      href: input.href,
      resolvableInOpsFlow: definition.resolvableInOpsFlow,
      jobNo: null,
      tripRef: null,
      containerNo: null,
      customerName: null,
      driverName: null,
      invoiceNo: null,
    };
  }

  private async hydrateExceptionReferences(
    tenantId: string,
    rows: StatisticsExceptionItemDto[],
  ): Promise<void> {
    if (rows.length === 0) return;
    const jobIds = Array.from(
      new Set(rows.map((row) => row.jobId).filter((id): id is string => !!id)),
    );
    const tripIds = Array.from(
      new Set(rows.map((row) => row.tripId).filter((id): id is string => !!id)),
    );
    const invoiceIds = Array.from(
      new Set(
        rows.map((row) => row.invoiceId).filter((id): id is string => !!id),
      ),
    );
    const [jobs, trips, invoices] = await Promise.all([
      jobIds.length
        ? this.prisma.job.findMany({
            where: { tenantId, id: { in: jobIds } },
            select: {
              id: true,
              internalRef: true,
              customerCompany: { select: { name: true } },
              items: { select: { itemCode: true }, take: 3 },
            },
          })
        : Promise.resolve([]),
      tripIds.length
        ? this.prisma.trip.findMany({
            where: { tenantId, id: { in: tripIds } },
            select: {
              id: true,
              jobSequence: true,
              tripSequence: true,
              assignedDriverUserId: true,
              job: { select: { internalRef: true } },
              tripJobItems: {
                select: { jobItem: { select: { itemCode: true } } },
                take: 3,
              },
            },
          })
        : Promise.resolve([]),
      invoiceIds.length
        ? this.prisma.invoice.findMany({
            where: { tenantId, id: { in: invoiceIds } },
            select: { id: true, invoiceNo: true, customerName: true },
          })
        : Promise.resolve([]),
    ]);
    const jobById = new Map(
      (jobs as Array<{
        id: string;
        internalRef: string;
        customerCompany: { name: string };
        items: Array<{ itemCode: string }>;
      }>).map((job) => [job.id, job] as const),
    );
    const tripById = new Map(
      (trips as Array<{
        id: string;
        jobSequence: number | null;
        tripSequence: number | null;
        assignedDriverUserId: string | null;
        job: { internalRef: string } | null;
        tripJobItems: Array<{ jobItem: { itemCode: string } }>;
      }>).map((trip) => [trip.id, trip] as const),
    );
    const invoiceById = new Map(
      (invoices as Array<{
        id: string;
        invoiceNo: string;
        customerName: string;
      }>).map((invoice) => [invoice.id, invoice] as const),
    );
    const driverIds = Array.from(
      new Set(
        Array.from(tripById.values())
          .map((trip) => trip.assignedDriverUserId)
          .filter((id): id is string => !!id),
      ),
    );
    const drivers =
      driverIds.length > 0
        ? ((await this.prisma.drivers.findMany({
            where: { tenantId, userId: { in: driverIds } },
            select: { userId: true, name: true },
          })) as Array<{ userId: string | null; name: string | null }>)
        : [];
    const driverNames = new Map(
      drivers
        .filter((row): row is { userId: string; name: string | null } => !!row.userId)
        .map((row) => [row.userId, row.name?.trim() || "Unnamed driver"] as const),
    );

    for (const row of rows) {
      const job = row.jobId ? jobById.get(row.jobId) : undefined;
      const trip = row.tripId ? tripById.get(row.tripId) : undefined;
      const invoice = row.invoiceId ? invoiceById.get(row.invoiceId) : undefined;
      row.jobNo = job?.internalRef ?? trip?.job?.internalRef ?? null;
      row.customerName =
        job?.customerCompany?.name ?? invoice?.customerName ?? null;
      row.invoiceNo = invoice?.invoiceNo ?? null;
      if (trip) {
        row.tripRef = `${row.jobNo ?? "Job"} · Trip ${trip.jobSequence ?? trip.tripSequence ?? ""}`.trim();
        row.driverName = trip.assignedDriverUserId
          ? driverNames.get(trip.assignedDriverUserId) ?? "Unnamed driver"
          : null;
        const containerNos = (trip.tripJobItems ?? [])
          .map((link) => link.jobItem?.itemCode)
          .filter(Boolean);
        row.containerNo = containerNos.join(", ") || null;
      } else if (job) {
        row.containerNo =
          (job.items ?? [])
            .map((item) => item.itemCode)
            .filter(Boolean)
            .join(", ") || null;
      }
    }
  }
}
