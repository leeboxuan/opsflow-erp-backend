import { JobStatus, Prisma } from "@prisma/client";

/** Invoice statuses that mean the job has a generated/saved invoice (see finance InvoicesService). */
export const INVOICED_INVOICE_STATUSES = ["Sent", "Issued", "Paid"] as const;

/**
 * Shared READY_FOR_INVOICE − Sent/Issued/Paid predicate (tenant-scoped on job and invoice).
 * Used by Phase 1 KPI count and Phase 2 attention list.
 */
export function readyForInvoiceNotInvoicedCountSql(tenantId: string) {
  return Prisma.sql`
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
  `;
}

export function readyForInvoiceNotInvoicedListSql(
  tenantId: string,
  limit: number,
) {
  return Prisma.sql`
    SELECT j."id", j."invoiceReadyAt", j."updatedAt"
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
    ORDER BY COALESCE(j."invoiceReadyAt", j."updatedAt") ASC, j."id" ASC
    LIMIT ${limit}
  `;
}

export type JobStatusCountMap = Record<JobStatus, number>;

export type DashboardJobMetrics = {
  total: number;
  ongoing: number;
  readyForInvoice: number;
  readyForInvoiceNotInvoiced: number;
  completed: number;
  cancelled: number;
  byStatus: JobStatusCountMap;
};

export function buildJobStatusCountMap(
  rows: Array<{ status: JobStatus; count: number }>,
): JobStatusCountMap {
  const map: JobStatusCountMap = {
    [JobStatus.ONGOING]: 0,
    [JobStatus.READY_FOR_INVOICE]: 0,
    [JobStatus.COMPLETED]: 0,
    [JobStatus.CANCELLED]: 0,
  };
  for (const row of rows) {
    if (row.status in map) {
      map[row.status as JobStatus] = row.count;
    }
  }
  return map;
}

export function countReadyForInvoiceNotInvoiced(
  readyJobIds: string[],
  invoicedSourceJobIds: Array<string | null>,
): number {
  const invoiced = new Set(
    invoicedSourceJobIds.filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  return readyJobIds.filter((id) => !invoiced.has(id)).length;
}

export function buildDashboardJobMetrics(input: {
  total: number;
  byStatus: JobStatusCountMap;
  /** Precomputed count (preferred). When omitted, derived from ID lists. */
  readyForInvoiceNotInvoiced?: number;
  readyJobIds?: string[];
  invoicedSourceJobIds?: Array<string | null>;
  /** Jobs with READY_FOR_INVOICE status or invoiceReadyAt set (non-terminal). */
  readyForInvoiceBroadCount?: number;
}): DashboardJobMetrics {
  const byStatus = input.byStatus;
  const readyForInvoice =
    input.readyForInvoiceBroadCount ??
    byStatus[JobStatus.READY_FOR_INVOICE] ??
    0;

  const readyForInvoiceNotInvoiced =
    input.readyForInvoiceNotInvoiced ??
    countReadyForInvoiceNotInvoiced(
      input.readyJobIds ?? [],
      input.invoicedSourceJobIds ?? [],
    );

  return {
    total: input.total,
    ongoing: byStatus[JobStatus.ONGOING] ?? 0,
    readyForInvoice,
    readyForInvoiceNotInvoiced,
    completed: byStatus[JobStatus.COMPLETED] ?? 0,
    cancelled: byStatus[JobStatus.CANCELLED] ?? 0,
    byStatus,
  };
}
