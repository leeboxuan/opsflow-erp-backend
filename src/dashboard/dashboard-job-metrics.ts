import { JobStatus } from "@prisma/client";

/** Invoice statuses that mean the job has a generated/saved invoice (see finance InvoicesService). */
export const INVOICED_INVOICE_STATUSES = ["Sent", "Issued", "Paid"] as const;

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
  readyJobIds: string[];
  invoicedSourceJobIds: Array<string | null>;
  /** Jobs with READY_FOR_INVOICE status or invoiceReadyAt set (non-terminal). */
  readyForInvoiceBroadCount?: number;
}): DashboardJobMetrics {
  const byStatus = input.byStatus;
  const readyForInvoice =
    input.readyForInvoiceBroadCount ??
    byStatus[JobStatus.READY_FOR_INVOICE] ??
    0;

  return {
    total: input.total,
    ongoing: byStatus[JobStatus.ONGOING] ?? 0,
    readyForInvoice,
    readyForInvoiceNotInvoiced: countReadyForInvoiceNotInvoiced(
      input.readyJobIds,
      input.invoicedSourceJobIds,
    ),
    completed: byStatus[JobStatus.COMPLETED] ?? 0,
    cancelled: byStatus[JobStatus.CANCELLED] ?? 0,
    byStatus,
  };
}
