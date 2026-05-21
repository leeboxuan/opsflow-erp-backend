import { JobStatus } from "@prisma/client";
import {
  buildDashboardJobMetrics,
  buildJobStatusCountMap,
  countReadyForInvoiceNotInvoiced,
} from "./dashboard-job-metrics";

describe("dashboard job metrics", () => {
  it("buildJobStatusCountMap initializes all JobStatus keys", () => {
    const map = buildJobStatusCountMap([
      { status: JobStatus.ONGOING, count: 3 },
      { status: JobStatus.READY_FOR_INVOICE, count: 2 },
    ]);
    expect(map).toEqual({
      ONGOING: 3,
      READY_FOR_INVOICE: 2,
      COMPLETED: 0,
      CANCELLED: 0,
    });
  });

  it("countReadyForInvoiceNotInvoiced excludes jobs with generated invoices", () => {
    expect(
      countReadyForInvoiceNotInvoiced(
        ["job-a", "job-b", "job-c"],
        ["job-a", null],
      ),
    ).toBe(2);
  });

  it("buildDashboardJobMetrics maps status counts and not-invoiced ready jobs", () => {
    const metrics = buildDashboardJobMetrics({
      total: 10,
      byStatus: {
        [JobStatus.ONGOING]: 5,
        [JobStatus.READY_FOR_INVOICE]: 3,
        [JobStatus.COMPLETED]: 1,
        [JobStatus.CANCELLED]: 1,
      },
      readyJobIds: ["r1", "r2", "r3"],
      invoicedSourceJobIds: ["r1"],
      readyForInvoiceBroadCount: 4,
    });

    expect(metrics).toEqual({
      total: 10,
      ongoing: 5,
      readyForInvoice: 4,
      readyForInvoiceNotInvoiced: 2,
      completed: 1,
      cancelled: 1,
      byStatus: {
        ONGOING: 5,
        READY_FOR_INVOICE: 3,
        COMPLETED: 1,
        CANCELLED: 1,
      },
    });
  });
});
