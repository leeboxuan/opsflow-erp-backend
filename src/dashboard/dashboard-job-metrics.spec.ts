import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JobStatus, Prisma } from "@prisma/client";
import {
  buildDashboardJobMetrics,
  buildJobStatusCountMap,
  countReadyForInvoiceNotInvoiced,
  invoiceStatusEnumSql,
  INVOICED_INVOICE_STATUSES,
  readyForInvoiceNotInvoicedCountSql,
  readyForInvoiceNotInvoicedListSql,
} from "./dashboard-job-metrics";

function sqlFragmentText(sql: Prisma.Sql): string {
  return sql.strings.join("?");
}

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

  it("buildDashboardJobMetrics prefers precomputed readyForInvoiceNotInvoiced", () => {
    const metrics = buildDashboardJobMetrics({
      total: 10,
      byStatus: {
        [JobStatus.ONGOING]: 5,
        [JobStatus.READY_FOR_INVOICE]: 3,
        [JobStatus.COMPLETED]: 1,
        [JobStatus.CANCELLED]: 1,
      },
      readyForInvoiceNotInvoiced: 7,
      readyJobIds: ["r1"],
      invoicedSourceJobIds: [],
      readyForInvoiceBroadCount: 4,
    });
    expect(metrics.readyForInvoiceNotInvoiced).toBe(7);
  });
});

describe("ready-for-invoice InvoiceStatus SQL enum typing", () => {
  it("casts each ISSUED/PAID parameter as PostgreSQL InvoiceStatus", () => {
    const typed = invoiceStatusEnumSql([...INVOICED_INVOICE_STATUSES]);
    const text = sqlFragmentText(typed);
    expect([...INVOICED_INVOICE_STATUSES]).toEqual(["ISSUED", "PAID"]);
    expect(typed.values).toEqual(["ISSUED", "PAID"]);
    expect(text).toBe('?::"InvoiceStatus",?::"InvoiceStatus"');
    expect(text).not.toMatch(/::text/);
  });

  it.each([
    ["count", readyForInvoiceNotInvoicedCountSql("tenant-a")],
    ["list", readyForInvoiceNotInvoicedListSql("tenant-a", 25)],
  ] as const)(
    "%s SQL binds InvoiceStatus enums and keeps ISSUED/PAID-only semantics",
    (_label, sql) => {
      const text = sqlFragmentText(sql);
      expect(text).toContain('i."status" IN (');
      expect(text).toContain('::"InvoiceStatus"');
      expect(text).not.toContain('i."status"::text');
      expect(text).not.toContain("$queryRawUnsafe");
      // Each status placeholder must be immediately cast — no bare text IN-list.
      expect(text.replace(/\s+/g, " ")).toMatch(
        /i\."status" IN \(\?::"InvoiceStatus",\?::"InvoiceStatus"\)/,
      );
      expect(sql.values).toEqual(
        expect.arrayContaining(["tenant-a", JobStatus.READY_FOR_INVOICE, "ISSUED", "PAID"]),
      );
      expect(sql.values).not.toEqual(expect.arrayContaining(["DRAFT", "GENERATED", "VOID"]));
      expect(sql.values.filter((value) => value === "ISSUED")).toHaveLength(1);
      expect(sql.values.filter((value) => value === "PAID")).toHaveLength(1);
    },
  );
});

describe("InvoiceStatus raw-SQL contract (dashboard)", () => {
  const source = readFileSync(join(__dirname, "dashboard-job-metrics.ts"), "utf8");
  const migration = readFileSync(
    join(
      __dirname,
      "../../prisma/migrations/20260817120000_invoice_status_enum/migration.sql",
    ),
    "utf8",
  );

  it("keeps dashboard invoice status filters on the real PostgreSQL enum", () => {
    expect(migration).toContain('CREATE TYPE "InvoiceStatus" AS ENUM');
    expect(source).toContain('::"InvoiceStatus"');
    expect(source).toContain("invoiceStatusEnumSql");
    expect(source).not.toMatch(
      /i\."status"\s+IN\s*\(\s*\$\{Prisma\.join\(\[\.\.\.INVOICED_INVOICE_STATUSES\]\)\}/,
    );
    expect(source).not.toMatch(/i\."status"\s*::\s*text/);
    expect(source).not.toContain("$queryRawUnsafe");
  });
});
