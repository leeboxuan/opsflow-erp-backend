import {
  CanonicalTenantRole,
  InvoiceStatus,
  JobStatus,
  JobType,
  Role,
  TripStatus,
} from "@prisma/client";
import { TransportJobsService } from "./transport-jobs.service";

function sqlText(sql: { strings?: string[]; values?: unknown[] } | unknown): string {
  if (!sql || typeof sql !== "object") return String(sql ?? "");
  const fragment = sql as { strings?: string[]; values?: unknown[] };
  if (!Array.isArray(fragment.strings)) return String(sql);
  const values = fragment.values ?? [];
  return fragment.strings.reduce((acc, str, index) => {
    const value = values[index];
    const nested =
      value &&
      typeof value === "object" &&
      Array.isArray((value as { strings?: string[] }).strings)
        ? sqlText(value)
        : value === undefined || value === null
          ? ""
          : String(value);
    return acc + str + nested;
  }, "");
}

function listJobRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "job1",
    tenantId: "t1",
    customerCompanyId: "c1",
    internalRef: "WF-2026-05-0001-LCL",
    externalRef: "EXT-1",
    jobType: JobType.LCL,
    collectionType: null,
    status: JobStatus.ONGOING,
    pickupDate: new Date("2026-05-21"),
    createdAt: new Date("2026-05-20"),
    updatedAt: new Date("2026-05-21"),
    customerCompany: { name: "ACME" },
    _count: { items: 3, trips: 2, documents: 1 },
    trips: [{ assignedDriverUserId: "driver-1" }],
    ...overrides,
  };
}

function makeListPrisma(jobs = [listJobRow()]) {
  const tripFindMany = jest.fn().mockResolvedValue([
    { jobId: "job1", status: TripStatus.COMPLETED },
    { jobId: "job1", status: TripStatus.DONE },
  ]);
  const invoiceFindMany = jest.fn().mockResolvedValue([
    {
      id: "inv-new",
      status: InvoiceStatus.PAID,
      sourceJobId: "job1",
      createdAt: new Date("2026-06-02T00:00:00.000Z"),
    },
    {
      id: "inv-old",
      status: InvoiceStatus.DRAFT,
      sourceJobId: "job1",
      createdAt: new Date("2026-06-01T00:00:00.000Z"),
    },
  ]);
  const jobCount = jest.fn().mockResolvedValue(jobs.length);
  const jobFindMany = jest.fn().mockResolvedValue(jobs);
  const queryRaw = jest.fn(async (sql: unknown) => {
    const text = sqlText(sql);
    if (/COUNT/i.test(text)) return [{ count: BigInt(jobs.length) }];
    return jobs.map((job) => ({ id: job.id }));
  });
  const prisma: any = {
    $transaction: jest.fn((ops: any[]) => Promise.all(ops.map((fn) => fn))),
    $queryRaw: queryRaw,
    job: { count: jobCount, findMany: jobFindMany },
    trip: { findMany: tripFindMany },
    invoice: { findMany: invoiceFindMany },
    tenantMembership: {
      findMany: jest.fn().mockResolvedValue([
        { userId: "driver-1", user: { name: "Driver One", email: "d@example.com" } },
      ]),
    },
  };
  const svc = new TransportJobsService(prisma, { log: jest.fn() } as any, {} as any);
  return {
    prisma,
    svc,
    tripFindMany,
    invoiceFindMany,
    jobCount,
    jobFindMany,
    queryRaw,
  };
}

const staff = { role: Role.TRANSPORT_STAFF, roles: [CanonicalTenantRole.TRANSPORT_ADMIN] };
const customer = {
  role: Role.CUSTOMER,
  roles: [CanonicalTenantRole.CUSTOMER_ADMIN],
  customerCompanyId: "c1",
};

describe("TransportJobsService.list (slim)", () => {
  it("returns list rows without full trips/items/documents", async () => {
    const { prisma, svc } = makeListPrisma();
    const res = await svc.list("t1", {} as any, staff);

    expect(res.data).toHaveLength(1);
    expect(res.data[0]).toEqual(
      expect.objectContaining({
        id: "job1",
        companyName: "ACME",
        tripCount: 2,
        itemCount: 3,
        documentCount: 1,
        assignedDriverId: "driver-1",
        assignedDriverName: "Driver One",
        tripProgress: { completed: 2, total: 2, isComplete: true },
        invoice: { id: "inv-new", status: InvoiceStatus.PAID },
      }),
    );
    expect(res.data[0]).not.toHaveProperty("trips");
    expect(res.data[0]).not.toHaveProperty("items");
    expect(res.data[0]).not.toHaveProperty("charges");
    expect(res.data[0]).not.toHaveProperty("totalCents");
    expect(res.data[0].invoice).not.toHaveProperty("totalCents");

    const findManyArg = prisma.job.findMany.mock.calls[0][0];
    expect(findManyArg.select).toBeDefined();
    expect(findManyArg.include).toBeUndefined();
    expect(findManyArg.select.trips.take).toBe(1);
  });
});

describe("TransportJobsService.list trip and invoice contract", () => {
  it("does not issue per-row trip or invoice queries", async () => {
    const jobs = [
      listJobRow({ id: "job1" }),
      listJobRow({ id: "job2", internalRef: "JOB-2" }),
    ];
    const { svc, tripFindMany, invoiceFindMany, queryRaw } = makeListPrisma(jobs);
    tripFindMany.mockResolvedValue([
      { jobId: "job1", status: TripStatus.COMPLETED },
      { jobId: "job2", status: TripStatus.PUBLISHED },
    ]);
    invoiceFindMany.mockResolvedValue([]);
    await svc.list("t1", { page: 1, pageSize: 20 } as any, staff);
    expect(tripFindMany).toHaveBeenCalledTimes(1);
    expect(invoiceFindMany).toHaveBeenCalledTimes(1);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(tripFindMany.mock.calls[0][0].where).toEqual({
      tenantId: "t1",
      jobId: { in: ["job1", "job2"] },
    });
    expect(invoiceFindMany.mock.calls[0][0].select).toEqual({
      id: true,
      status: true,
      sourceJobId: true,
      createdAt: true,
    });
    expect(invoiceFindMany.mock.calls[0][0].where).toEqual({
      tenantId: "t1",
      sourceJobId: { in: ["job1", "job2"] },
    });
  });

  it("keeps list queries tenant-scoped", async () => {
    const { svc, jobFindMany, jobCount, tripFindMany, invoiceFindMany } =
      makeListPrisma();
    await svc.list("t1", {} as any, staff);
    expect(jobCount.mock.calls[0][0].where.AND[0]).toEqual({ tenantId: "t1" });
    expect(jobFindMany.mock.calls[0][0].where.AND[0]).toEqual({ tenantId: "t1" });
    expect(tripFindMany.mock.calls[0][0].where.tenantId).toBe("t1");
    expect(invoiceFindMany.mock.calls[0][0].where.tenantId).toBe("t1");
  });

  it("locks Customer Admin to their own company and ignores companyId", async () => {
    const { svc, jobFindMany } = makeListPrisma();
    await svc.list(
      "t1",
      { companyId: "other-company" } as any,
      customer,
    );
    const where = jobFindMany.mock.calls[0][0].where;
    expect(where.AND).toEqual(
      expect.arrayContaining([{ tenantId: "t1", customerCompanyId: "c1" }]),
    );
    expect(JSON.stringify(where)).not.toContain("other-company");
  });

  it("paginates and sorts by createdAt when requested", async () => {
    const { svc, jobFindMany } = makeListPrisma();
    await svc.list(
      "t1",
      { page: 2, pageSize: 10, sortBy: "createdAt", sortDir: "asc" } as any,
      staff,
    );
    expect(jobFindMany.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: { createdAt: "asc" },
      }),
    );
  });

  it("filters invoice status with bounded SQL before count and page selection", async () => {
    const jobs = [
      listJobRow({ id: "job1" }),
      listJobRow({ id: "job2", internalRef: "JOB-2" }),
      listJobRow({ id: "job3", internalRef: "JOB-3" }),
    ];
    const { svc, jobCount, jobFindMany, invoiceFindMany, queryRaw } =
      makeListPrisma(jobs);
    queryRaw.mockImplementation(async (sql: unknown) => {
      const text = sqlText(sql);
      if (/COUNT/i.test(text)) return [{ count: BigInt(5) }];
      return [{ id: "job2" }];
    });
    jobFindMany.mockResolvedValue([listJobRow({ id: "job2", internalRef: "JOB-2" })]);
    invoiceFindMany.mockResolvedValue([]);

    const res = await svc.list(
      "t1",
      {
        page: 2,
        pageSize: 1,
        tripProgress: "complete",
        invoiceStatus: "waiting",
        q: "JOB",
        sortBy: "createdAt",
        sortDir: "desc",
      } as any,
      staff,
    );

    expect(jobCount).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(2);
    const countSql = sqlText(queryRaw.mock.calls[0][0]);
    const pageSql = sqlText(queryRaw.mock.calls[1][0]);
    const whereNeedle = 'j."tenantId"';
    expect(countSql).toContain(whereNeedle);
    expect(pageSql).toContain(whereNeedle);
    expect(countSql).toContain("NOT EXISTS");
    expect(pageSql).toContain("NOT EXISTS");
    expect(countSql).toContain("COMPLETED");
    expect(pageSql).toContain("COMPLETED");
    expect(countSql).not.toContain("READY_FOR_INVOICE");
    expect(pageSql).toMatch(/LIMIT/i);
    expect(pageSql).toMatch(/OFFSET/i);
    expect(res.meta).toEqual({ page: 2, pageSize: 1, total: 5 });
    expect(invoiceFindMany.mock.calls[0][0].where.sourceJobId).toEqual({
      in: ["job2"],
    });
    expect(JSON.stringify(invoiceFindMany.mock.calls[0][0].where)).not.toContain(
      "job1",
    );
    expect(JSON.stringify(invoiceFindMany.mock.calls[0][0].where)).not.toContain(
      "job3",
    );
    expect(JSON.stringify(invoiceFindMany.mock.calls[0][0].where)).not.toContain(
      "not:null",
    );
  });

  it("combines Customer Admin company scope with the invoice SQL predicate", async () => {
    const { svc, queryRaw, jobFindMany } = makeListPrisma();
    await svc.list(
      "t1",
      { invoiceStatus: "PAID", companyId: "other-company" } as any,
      customer,
    );
    const sql = queryRaw.mock.calls.map((call) => sqlText(call[0])).join("\n");
    expect(sql).toContain("c1");
    expect(sql).not.toContain("other-company");
    expect(sql).toContain('i."tenantId"');
    expect(jobFindMany.mock.calls[0][0].where.AND).toEqual(
      expect.arrayContaining([{ tenantId: "t1", customerCompanyId: "c1" }]),
    );
  });

  it("does not use pickup-date predicates unless those query params are sent", async () => {
    const { svc, jobFindMany } = makeListPrisma();
    await svc.list("t1", { tripProgress: "incomplete" } as any, staff);
    expect(JSON.stringify(jobFindMany.mock.calls[0][0].where)).not.toContain(
      "pickupDate",
    );
  });

  it("keeps pickup/planned-date predicates as pickupDate OR trip plannedStartAt, not createdAt", async () => {
    const { svc, jobFindMany } = makeListPrisma();
    await svc.list("t1", { dateFrom: "2026-07-20", dateTo: "2026-08-18" } as any, staff);
    const encoded = JSON.stringify(jobFindMany.mock.calls[0][0].where);
    expect(encoded).toContain("pickupDate");
    expect(encoded).toContain("plannedStartAt");
    expect(encoded).not.toContain('"createdAt"');
  });
});
