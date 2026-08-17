import { readFileSync } from "node:fs";
import { join } from "node:path";
import { InvoiceStatus, JobStatus, Prisma, TripStatus } from "@prisma/client";
import {
  JOB_LIST_INVOICE_STATUS_VALUES,
  compareJobListInvoicesNewestFirst,
  indexLatestInvoicesByJobId,
  invoiceStatusFilterMatchesDisplay,
  invoiceStatusImpliedTripPredicate,
  jobListFilterWhereSql,
  jobListFilteredCountSql,
  jobListFilteredPageIdsSql,
  jobListInvoiceDisplayStatus,
  jobListPrismaWhere,
  jobListSharedFilterParts,
  jobMatchesInvoiceStatusFilter,
  tripProgressFromTrips,
  tripProgressPrismaWhere,
} from "./job-list-progress";

function sqlText(sql: Prisma.Sql): string {
  const values = (sql as unknown as { values?: unknown[] }).values ?? [];
  return sql.strings.reduce((acc, str, index) => {
    const value = values[index];
    const nested =
      value &&
      typeof value === "object" &&
      Array.isArray((value as Prisma.Sql).strings)
        ? sqlText(value as Prisma.Sql)
        : value === undefined || value === null
          ? ""
          : String(value);
    return acc + str + nested;
  }, "");
}

const zero = tripProgressFromTrips([]);
const allCancelled = tripProgressFromTrips([
  { status: TripStatus.CANCELLED },
  { status: TripStatus.CANCELLED },
]);
const incomplete = tripProgressFromTrips([
  { status: TripStatus.COMPLETED },
  { status: TripStatus.ONGOING },
  { status: TripStatus.PUBLISHED },
  { status: TripStatus.DRAFT },
]);
const complete = tripProgressFromTrips([
  { status: TripStatus.COMPLETED },
  { status: TripStatus.DONE },
]);

describe("job list trip progress", () => {
  it("counts 0 / N for operational trips that are not complete", () => {
    expect(
      tripProgressFromTrips([
        { status: TripStatus.PUBLISHED },
        { status: TripStatus.PUBLISHED },
        { status: TripStatus.DRAFT },
        { status: TripStatus.ONGOING },
      ]),
    ).toEqual({ completed: 0, total: 4, isComplete: false });
  });

  it("counts partial COMPLETED and DONE progress", () => {
    expect(incomplete).toEqual({ completed: 1, total: 4, isComplete: false });
  });

  it("treats COMPLETED and DONE as complete and excludes cancelled trips from both counts", () => {
    expect(
      tripProgressFromTrips([
        { status: TripStatus.COMPLETED },
        { status: TripStatus.DONE },
        { status: TripStatus.CANCELLED },
      ]),
    ).toEqual({ completed: 2, total: 2, isComplete: true });
  });

  it("does not treat all-cancelled or zero trips as complete", () => {
    expect(zero).toEqual({ completed: 0, total: 0, isComplete: false });
    expect(allCancelled).toEqual({ completed: 0, total: 0, isComplete: false });
  });
});

describe("canonical newest linked invoice", () => {
  it("documents that sourceJobId is not unique and Job has no invoices relation", () => {
    const schema = readFileSync(
      join(process.cwd(), "prisma/schema.prisma"),
      "utf8",
    );
    expect(schema).toContain("@@index([tenantId, sourceJobId])");
    expect(schema).not.toMatch(/@@unique\(\[tenantId,\s*sourceJobId\]\)/);
    const jobModel = schema.slice(
      schema.indexOf("model Job {"),
      schema.indexOf("model JobItem {"),
    );
    expect(jobModel).not.toMatch(/\binvoices\b/);
    const serviceSrc = readFileSync(
      join(process.cwd(), "src/transport/jobs/transport-jobs.service.ts"),
      "utf8",
    );
    expect(serviceSrc).not.toContain("$queryRawUnsafe");
    expect(serviceSrc).not.toContain("loadLatestInvoicesByJobId");
    expect(serviceSrc).not.toContain("sourceJobId: { not: null }");
  });

  it("picks newer createdAt even when the older invoice is PAID", () => {
    const latest = indexLatestInvoicesByJobId([
      {
        id: "older-paid",
        status: InvoiceStatus.PAID,
        sourceJobId: "job-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "newer-draft",
        status: InvoiceStatus.DRAFT,
        sourceJobId: "job-1",
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);
    expect(latest.get("job-1")).toEqual(
      expect.objectContaining({ id: "newer-draft", status: InvoiceStatus.DRAFT }),
    );
  });

  it("picks newer VOID over older PAID", () => {
    const latest = indexLatestInvoicesByJobId([
      {
        id: "older-paid",
        status: InvoiceStatus.PAID,
        sourceJobId: "job-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "newer-void",
        status: InvoiceStatus.VOID,
        sourceJobId: "job-1",
        createdAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    ]);
    expect(latest.get("job-1")?.status).toBe(InvoiceStatus.VOID);
  });

  it("tie-breaks equal createdAt by id DESC", () => {
    const same = new Date("2026-04-01T00:00:00.000Z");
    const latest = indexLatestInvoicesByJobId([
      {
        id: "aaa",
        status: InvoiceStatus.DRAFT,
        sourceJobId: "job-1",
        createdAt: same,
      },
      {
        id: "zzz",
        status: InvoiceStatus.PAID,
        sourceJobId: "job-1",
        createdAt: same,
      },
    ]);
    expect(latest.get("job-1")).toEqual(
      expect.objectContaining({ id: "zzz", status: InvoiceStatus.PAID }),
    );
    expect(
      compareJobListInvoicesNewestFirst(
        { id: "aaa", createdAt: same },
        { id: "zzz", createdAt: same },
      ),
    ).toBeGreaterThan(0);
  });
});

describe("invoice display and filter parity", () => {
  const paid = {
    id: "inv-paid",
    status: InvoiceStatus.PAID,
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
  };
  const rows = [
    { name: "zero trips / no invoice", progress: zero, invoice: null, display: "NOT_AVAILABLE" },
    {
      name: "all-cancelled / no invoice",
      progress: allCancelled,
      invoice: null,
      display: "NOT_AVAILABLE",
    },
    {
      name: "incomplete / no invoice",
      progress: incomplete,
      invoice: null,
      display: "NOT_AVAILABLE",
    },
    {
      name: "complete / no invoice",
      progress: complete,
      invoice: null,
      display: "WAITING",
    },
    {
      name: "complete / paid invoice",
      progress: complete,
      invoice: paid,
      display: "PAID",
    },
    {
      name: "incomplete / paid invoice",
      progress: incomplete,
      invoice: paid,
      display: "PAID",
    },
    {
      name: "zero trips / paid invoice",
      progress: zero,
      invoice: paid,
      display: "PAID",
    },
  ] as const;

  it("maps every fixture to the product display table", () => {
    for (const row of rows) {
      expect(jobListInvoiceDisplayStatus(row.progress, row.invoice)).toBe(
        row.display,
      );
    }
  });

  it("returns a row from an invoice filter iff the column would display that status", () => {
    for (const filter of JOB_LIST_INVOICE_STATUS_VALUES) {
      for (const row of rows) {
        const display = jobListInvoiceDisplayStatus(row.progress, row.invoice);
        expect(jobMatchesInvoiceStatusFilter(filter, row.progress, row.invoice)).toBe(
          invoiceStatusFilterMatchesDisplay(filter, display),
        );
        const expected =
          filter === "not_available"
            ? display === "NOT_AVAILABLE"
            : filter === "waiting"
              ? display === "WAITING"
              : display === filter;
        expect(jobMatchesInvoiceStatusFilter(filter, row.progress, row.invoice)).toBe(
          expected,
        );
      }
    }
  });

  it("includes zero and all-cancelled jobs in Not Available and excludes complete/no-invoice and invoiced jobs", () => {
    expect(jobMatchesInvoiceStatusFilter("not_available", zero, null)).toBe(true);
    expect(jobMatchesInvoiceStatusFilter("not_available", allCancelled, null)).toBe(
      true,
    );
    expect(jobMatchesInvoiceStatusFilter("not_available", incomplete, null)).toBe(
      true,
    );
    expect(jobMatchesInvoiceStatusFilter("not_available", complete, null)).toBe(
      false,
    );
    expect(jobMatchesInvoiceStatusFilter("waiting", complete, null)).toBe(true);
    expect(jobMatchesInvoiceStatusFilter("not_available", complete, paid)).toBe(
      false,
    );
    expect(jobMatchesInvoiceStatusFilter("not_available", incomplete, paid)).toBe(
      false,
    );
  });

  it.each([
    InvoiceStatus.DRAFT,
    InvoiceStatus.GENERATED,
    InvoiceStatus.ISSUED,
    InvoiceStatus.PAID,
    InvoiceStatus.VOID,
  ])("shows canonical invoice status %s when an invoice exists", (status) => {
    const invoice = { id: "inv-1", status };
    expect(jobListInvoiceDisplayStatus(incomplete, invoice)).toBe(status);
    expect(jobListInvoiceDisplayStatus(complete, invoice)).toBe(status);
    expect(jobMatchesInvoiceStatusFilter(status, complete, invoice)).toBe(true);
    expect(jobMatchesInvoiceStatusFilter("waiting", complete, invoice)).toBe(
      false,
    );
  });
});

describe("job list filter predicates", () => {
  it("builds trip-progress Prisma predicates without Job.status except cancelled jobs", () => {
    expect(JSON.stringify(tripProgressPrismaWhere("complete"))).not.toContain(
      `"status":"${JobStatus.ONGOING}"`,
    );
    expect(JSON.stringify(tripProgressPrismaWhere("complete"))).not.toContain(
      "READY_FOR_INVOICE",
    );
    expect(tripProgressPrismaWhere("cancelled")).toEqual({
      status: JobStatus.CANCELLED,
    });
    expect(tripProgressPrismaWhere("incomplete")).toEqual({
      trips: {
        some: {
          status: {
            in: [TripStatus.DRAFT, TripStatus.PUBLISHED, TripStatus.ONGOING],
          },
        },
      },
    });
    expect(tripProgressPrismaWhere("none")).toEqual({
      trips: { none: { status: { not: TripStatus.CANCELLED } } },
    });
  });

  it("treats Not Available as not-complete trips, including zero and all-cancelled", () => {
    expect(invoiceStatusImpliedTripPredicate("not_available")).toBe(
      "not_complete",
    );
    expect(invoiceStatusImpliedTripPredicate("waiting")).toBe("complete");
    expect(tripProgressPrismaWhere("not_complete")).toEqual({
      NOT: tripProgressPrismaWhere("complete"),
    });
    const sql = sqlText(
      jobListFilterWhereSql({
        tenantId: "t1",
        invoiceStatus: "not_available",
      }),
    );
    expect(sql).toContain("NOT (");
    expect(sql).toContain("NOT EXISTS");
    expect(sql).not.toMatch(/READY_FOR_INVOICE/);
  });

  it("uses the same WHERE for invoice-filter count and page id queries", () => {
    const constraints = {
      tenantId: "t1",
      companyScopeId: "c1",
      search: "BD-02",
      tripProgress: "incomplete" as const,
      invoiceStatus: "not_available" as const,
      sortBy: "createdAt",
      sortDir: "desc" as const,
    };
    const where = sqlText(jobListFilterWhereSql(constraints));
    expect(sqlText(jobListFilteredCountSql(constraints))).toContain(where);
    expect(sqlText(jobListFilteredPageIdsSql(constraints, 20, 10))).toContain(
      where,
    );
    expect(sqlText(jobListFilteredPageIdsSql(constraints, 20, 10))).toContain(
      "LIMIT",
    );
    expect(sqlText(jobListFilteredPageIdsSql(constraints, 20, 10))).toContain(
      "OFFSET",
    );
  });

  it("scopes invoice SQL to tenant and company and never selects tenant-wide invoices", () => {
    const sql = sqlText(
      jobListFilterWhereSql({
        tenantId: "t1",
        companyScopeId: "c1",
        invoiceStatus: "PAID",
      }),
    );
    expect(sql).toContain('j."tenantId"');
    expect(sql).toContain('j."customerCompanyId"');
    expect(sql).toContain('i."tenantId"');
    expect(sql).toContain('i."sourceJobId" = j.id');
    expect(sql).toContain('ORDER BY i."createdAt" DESC, i.id DESC');
    expect(sql).toContain("LIMIT 1");
    expect(sql).not.toContain('sourceJobId" IS NOT NULL');
  });

  it("combines explicit trip filters with invoice predicates", () => {
    const { prismaAnd, sqlParts } = jobListSharedFilterParts({
      tenantId: "t1",
      tripProgress: "complete",
      invoiceStatus: "waiting",
    });
    expect(JSON.stringify(prismaAnd)).toContain("COMPLETED");
    expect(sqlParts.map(sqlText).join(" ")).toContain("NOT EXISTS");
    const paid = sqlText(
      jobListFilterWhereSql({
        tenantId: "t1",
        tripProgress: "incomplete",
        invoiceStatus: "PAID",
        search: "ACME",
      }),
    );
    expect(paid.toLowerCase()).toContain("ilike");
    expect(paid).toContain("PAID");
  });

  it("does not add pickup-date predicates unless those query params are set", () => {
    const encoded = JSON.stringify(
      jobListPrismaWhere({ tenantId: "t1", tripProgress: "incomplete" }),
    );
    expect(encoded).not.toContain("pickupDate");
  });
});

describe("boss-demo Jobs list rendering", () => {
  it.each([
    ["BD-01", { completed: 2, total: 2, isComplete: true }, InvoiceStatus.PAID, "PAID"],
    ["BD-02", { completed: 3, total: 4, isComplete: false }, null, "NOT_AVAILABLE"],
    ["BD-03", { completed: 1, total: 1, isComplete: true }, InvoiceStatus.GENERATED, "GENERATED"],
    ["BD-04", { completed: 1, total: 1, isComplete: true }, InvoiceStatus.ISSUED, "ISSUED"],
    ["BD-05", { completed: 2, total: 2, isComplete: true }, null, "WAITING"],
    ["BD-06", { completed: 1, total: 1, isComplete: true }, null, "WAITING"],
    ["BD-07", { completed: 1, total: 1, isComplete: true }, null, "WAITING"],
  ] as const)(
    "%s renders trip progress and invoice display without Job.status",
    (_ref, progress, invoiceStatus, display) => {
      expect(`${progress.completed} / ${progress.total}`).toMatch(/^\d+ \/ \d+$/);
      expect(
        jobListInvoiceDisplayStatus(
          progress,
          invoiceStatus ? { id: "inv", status: invoiceStatus } : null,
        ),
      ).toBe(display);
    },
  );
});
