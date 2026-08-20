import { Injectable, NotFoundException } from "@nestjs/common";
import {
  InvoiceStatus,
  TripExpenseReviewStatus,
  TripStatus,
} from "@prisma/client";
import { PrismaService } from "../../shared/prisma/prisma.service";
import { CANONICAL_TRIP_PAYOUT_LINE_SELECT } from "../trips/trip-payout.helpers";
import {
  aggregateAttributableInvoiceRevenueByJob,
  type InvoiceLineAttributionInput,
} from "./job-finance-invoice-attribution";
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

/** Job scan batch for listSummaries — never caps the tenant-wide result set. */
const LIST_JOB_BATCH_SIZE = 200;

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
   * Complete tenant pagination/filter without an arbitrary newest-N cap.
   * Scans jobs in ordered batches; keeps at most one page of rows in memory
   * while still computing the full filtered `meta.total`.
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
    const page = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(query.pageSize ?? 20) || 20),
    );
    const statusFilter = query.financeStatus;
    const pageStart = (page - 1) * pageSize;
    const pageEnd = pageStart + pageSize;

    const data: JobFinanceSummaryRow[] = [];
    let matchedTotal = 0;
    let offset = 0;

    for (;;) {
      const jobs = await this.prisma.job.findMany({
        where: { tenantId },
        select: { id: true, internalRef: true },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: LIST_JOB_BATCH_SIZE,
      });
      if (jobs.length === 0) break;

      const summaries = await this.summarizeJobs(
        tenantId,
        jobs.map((j) => j.id),
      );

      for (const job of jobs) {
        const summary = summaries.get(job.id);
        if (!summary) continue;
        if (statusFilter && summary.financeStatus !== statusFilter) continue;

        if (matchedTotal >= pageStart && matchedTotal < pageEnd) {
          data.push({
            jobId: job.id,
            jobInternalRef: job.internalRef ?? null,
            ...summary,
          });
        }
        matchedTotal += 1;
      }

      if (jobs.length < LIST_JOB_BATCH_SIZE) break;
      offset += LIST_JOB_BATCH_SIZE;
    }

    return {
      data,
      meta: { page, pageSize, total: matchedTotal },
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
