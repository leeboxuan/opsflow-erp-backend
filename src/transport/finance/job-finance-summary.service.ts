import { Injectable, NotFoundException } from "@nestjs/common";
import {
  InvoiceStatus,
  TripExpenseReviewStatus,
  TripStatus,
} from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import {
  elapsedMs,
  isOpsflowPerfApiEnabled,
  jsonResponseBytes,
  opsflowPerfApiLog,
} from "../../shared/perf/opsflow-perf-api";
import { CANONICAL_TRIP_PAYOUT_LINE_SELECT } from "../trips/trip-payout.helpers";
import {
  aggregateAttributableInvoiceRevenueByJob,
  type InvoiceLineAttributionInput,
} from "./job-finance-invoice-attribution";
import {
  jobFinanceSummaryCountSql,
  jobFinanceSummaryPageSql,
} from "./job-finance-summary-list.sql";
import {
  buildJobFinanceSummary,
  JOB_FINANCE_CURRENCY,
  sumDriverPayoutCentsForTrips,
  type JobFinanceStatus,
  type JobFinanceSummary,
} from "./job-finance-summary.helpers";

const RECOGNIZED_INVOICE_STATUSES: InvoiceStatus[] = [
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
];

export type JobFinanceSummaryRow = JobFinanceSummary & {
  jobId: string;
  jobInternalRef: string | null;
};

@Injectable()
export class JobFinanceSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async getForJob(
    tenantId: string,
    jobId: string,
  ): Promise<JobFinanceSummaryRow> {
    const job = await this.prisma.job.findFirst({
      where: { id: jobId, tenantId },
      select: { id: true, internalRef: true },
    });
    if (!job) throw new NotFoundException("Job not found");

    const map = await this.summarizeJobs(tenantId, [job.id]);
    const summary =
      map.get(job.id) ??
      buildJobFinanceSummary({
        currency: JOB_FINANCE_CURRENCY,
        driverPayoutCents: 0,
        miscPayoutCents: 0,
        totalJobBillableCents: 0,
        invoiceRevenueCents: null,
      });
    return {
      jobId: job.id,
      jobInternalRef: job.internalRef ?? null,
      ...summary,
    };
  }

  /**
   * Set-based aggregation for many jobs. No per-row finance queries.
   * Currency: SGD-only Phase 2 expenses; charge/invoice rows filtered to SGD.
   * Invoice revenue: charge-backed line attribution only (see job-finance-invoice-attribution).
   */
  async summarizeJobs(
    tenantId: string,
    jobIds: string[],
  ): Promise<Map<string, JobFinanceSummary>> {
    const uniqueIds = Array.from(
      new Set(jobIds.filter((id) => typeof id === "string" && id.trim())),
    );
    const result = new Map<string, JobFinanceSummary>();
    if (uniqueIds.length === 0) return result;

    for (const id of uniqueIds) {
      result.set(
        id,
        buildJobFinanceSummary({
          currency: JOB_FINANCE_CURRENCY,
          driverPayoutCents: 0,
          miscPayoutCents: 0,
          totalJobBillableCents: 0,
          invoiceRevenueCents: null,
        }),
      );
    }

    const [trips, chargeGroups, expenseGroups, attributedLines] =
      await Promise.all([
        this.prisma.trip.findMany({
          where: {
            tenantId,
            jobId: { in: uniqueIds },
            status: { not: TripStatus.CANCELLED },
          },
          select: {
            id: true,
            jobId: true,
            status: true,
            driverEarningCents: true,
            payoutLines: { select: CANONICAL_TRIP_PAYOUT_LINE_SELECT },
          },
        }),
        this.prisma.jobCharge.groupBy({
          by: ["jobId"],
          where: {
            tenantId,
            jobId: { in: uniqueIds },
            currency: JOB_FINANCE_CURRENCY,
          },
          _sum: { amountCents: true },
        }),
        this.prisma.tripExpense.groupBy({
          by: ["jobId"],
          where: {
            tenantId,
            jobId: { in: uniqueIds },
            reviewStatus: TripExpenseReviewStatus.APPROVED,
            currency: JOB_FINANCE_CURRENCY,
          },
          _sum: { amountCents: true },
        }),
        this.loadAttributableInvoiceLines(tenantId, uniqueIds),
      ]);

    const driverByJob = new Map<string, number>();
    const tripsByJob = new Map<string, typeof trips>();
    for (const trip of trips) {
      if (!trip.jobId) continue;
      const list = tripsByJob.get(trip.jobId) ?? [];
      list.push(trip);
      tripsByJob.set(trip.jobId, list);
    }
    for (const [jobId, jobTrips] of tripsByJob) {
      driverByJob.set(jobId, sumDriverPayoutCentsForTrips(jobTrips));
    }

    const billableByJob = new Map<string, number>();
    for (const row of chargeGroups) {
      billableByJob.set(row.jobId, Math.trunc(row._sum.amountCents ?? 0));
    }

    const miscByJob = new Map<string, number>();
    for (const row of expenseGroups) {
      miscByJob.set(row.jobId, Math.trunc(row._sum.amountCents ?? 0));
    }

    const invoiceByJob = aggregateAttributableInvoiceRevenueByJob(
      attributedLines,
      tenantId,
      uniqueIds,
    );

    for (const jobId of uniqueIds) {
      const hasInvoice = invoiceByJob.has(jobId);
      result.set(
        jobId,
        buildJobFinanceSummary({
          currency: JOB_FINANCE_CURRENCY,
          driverPayoutCents: driverByJob.get(jobId) ?? 0,
          miscPayoutCents: miscByJob.get(jobId) ?? 0,
          totalJobBillableCents: billableByJob.get(jobId) ?? 0,
          invoiceRevenueCents: hasInvoice
            ? (invoiceByJob.get(jobId) ?? 0)
            : null,
        }),
      );
    }

    return result;
  }

  /**
   * Paginate job IDs in SQL, then compute finance figures for that page only.
   * financeStatus is pushed down before LIMIT so totals/pages stay correct.
   */
  async listSummaries(
    tenantId: string,
    query: {
      page?: number;
      pageSize?: number;
      financeStatus?: JobFinanceStatus;
    },
  ): Promise<{
    data: JobFinanceSummaryRow[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    const totalStartedAt = Date.now();
    let prismaCalls = 0;
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(query.pageSize ?? 20) || 20),
    );
    const skip = (page - 1) * pageSize;
    const statusFilter = query.financeStatus;

    const candidateStartedAt = Date.now();
    const { jobs, total, pagePrismaCalls } = await this.listSummaryJobPage(
      tenantId,
      skip,
      pageSize,
      statusFilter,
    );
    prismaCalls += pagePrismaCalls;
    const candidateQueryMs = elapsedMs(candidateStartedAt);

    const enrichmentStartedAt = Date.now();
    const summaries = await this.summarizeJobs(
      tenantId,
      jobs.map((j) => j.id),
    );
    prismaCalls += jobs.length === 0 ? 0 : 4;
    const pageEnrichmentMs = elapsedMs(enrichmentStartedAt);

    const data: JobFinanceSummaryRow[] = jobs.map((job) => {
      const summary =
        summaries.get(job.id) ??
        buildJobFinanceSummary({
          currency: JOB_FINANCE_CURRENCY,
          driverPayoutCents: 0,
          miscPayoutCents: 0,
          totalJobBillableCents: 0,
          invoiceRevenueCents: null,
        });
      return {
        jobId: job.id,
        jobInternalRef: job.internalRef ?? null,
        ...summary,
      };
    });

    const result = {
      data,
      meta: { page, pageSize, total },
    };
    opsflowPerfApiLog("GET /finance/jobs/summaries", {
      durationMs: elapsedMs(totalStartedAt),
      candidateQueryMs,
      pageEnrichmentMs,
      prismaCalls,
      jobsScanned: jobs.length,
      returned: data.length,
      responseBytes: isOpsflowPerfApiEnabled() ? jsonResponseBytes(result) : 0,
    });
    return result;
  }

  private async listSummaryJobPage(
    tenantId: string,
    skip: number,
    take: number,
    financeStatus?: JobFinanceStatus,
  ): Promise<{
    jobs: Array<{ id: string; internalRef: string | null }>;
    total: number;
    pagePrismaCalls: number;
  }> {
    if (!financeStatus) {
      const [total, jobs] = await this.prisma.$transaction([
        this.prisma.job.count({ where: { tenantId } }),
        this.prisma.job.findMany({
          where: { tenantId },
          select: { id: true, internalRef: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          skip,
          take,
        }),
      ]);
      return { jobs, total, pagePrismaCalls: 2 };
    }

    const [countRows, idRows] = await Promise.all([
      this.prisma.$queryRaw(jobFinanceSummaryCountSql(tenantId, financeStatus)) as Promise<
        Array<{ c: bigint | number }>
      >,
      this.prisma.$queryRaw(
        jobFinanceSummaryPageSql(tenantId, financeStatus, skip, take),
      ) as Promise<Array<{ id: string; internalRef: string | null }>>,
    ]);
    return {
      jobs: idRows.map((row) => ({
        id: row.id,
        internalRef: row.internalRef ?? null,
      })),
      total: Number(countRows[0]?.c ?? 0),
      pagePrismaCalls: 2,
    };
  }

  async countByFinanceStatus(
    tenantId: string,
    jobIds: string[],
  ): Promise<Record<JobFinanceStatus, number>> {
    const summaries = await this.summarizeJobs(tenantId, jobIds);
    const counts: Record<JobFinanceStatus, number> = {
      NEGATIVE: 0,
      NON_NEGATIVE: 0,
      NOT_INVOICED: 0,
    };
    for (const summary of summaries.values()) {
      counts[summary.financeStatus] += 1;
    }
    return counts;
  }

  private async loadAttributableInvoiceLines(
    tenantId: string,
    jobIds: string[],
  ): Promise<InvoiceLineAttributionInput[]> {
    if (jobIds.length === 0) return [];

    const rows = await this.prisma.invoiceLineItem.findMany({
      where: {
        tenantId,
        jobChargeId: { not: null },
        jobCharge: {
          tenantId,
          jobId: { in: jobIds },
        },
        invoice: {
          tenantId,
          status: { in: RECOGNIZED_INVOICE_STATUSES },
          currency: JOB_FINANCE_CURRENCY,
        },
      },
      select: {
        id: true,
        tenantId: true,
        amountCents: true,
        taxCents: true,
        jobChargeId: true,
        jobCharge: {
          select: { jobId: true, tenantId: true },
        },
        invoice: {
          select: {
            id: true,
            tenantId: true,
            status: true,
            currency: true,
          },
        },
      },
    });

    return rows.map((row) => ({
      lineId: row.id,
      lineTenantId: row.tenantId,
      amountCents: row.amountCents,
      taxCents: row.taxCents,
      jobChargeId: row.jobChargeId,
      jobId: row.jobCharge?.jobId ?? null,
      chargeTenantId: row.jobCharge?.tenantId ?? null,
      invoiceId: row.invoice.id,
      invoiceTenantId: row.invoice.tenantId,
      invoiceStatus: row.invoice.status,
      invoiceCurrency: row.invoice.currency,
    }));
  }
}
