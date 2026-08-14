import { TripDocumentType, TripStatus } from "@prisma/client";
import { readFileSync } from "fs";
import { join } from "path";
import {
  StatisticsExceptionItemDto,
  StatisticsExceptionsQueryDto,
} from "./dto";
import {
  compareExceptions,
  StatisticsExceptionsService,
} from "./statistics-exceptions.service";

function query(
  input: Partial<StatisticsExceptionsQueryDto> = {},
): StatisticsExceptionsQueryDto {
  return Object.assign(new StatisticsExceptionsQueryDto(), {
    from: "2026-08-01",
    to: "2026-08-01",
    page: 1,
    pageSize: 20,
    sortBy: "severity",
    sortDir: "desc",
    ...input,
  });
}

function trip(
  input: Partial<{
    id: string;
    jobId: string | null;
    status: TripStatus;
    startedAt: Date | null;
    closedAt: Date | null;
    plannedStartAt: Date | null;
    updatedAt: Date;
    completionRuleJson: object | null;
  }> = {},
) {
  return {
    id: "trip-1",
    jobId: "job-1",
    status: TripStatus.COMPLETED,
    startedAt: new Date("2026-08-01T01:00:00.000Z"),
    closedAt: new Date("2026-08-01T02:00:00.000Z"),
    plannedStartAt: null,
    updatedAt: new Date("2026-08-01T02:00:00.000Z"),
    completionRuleJson: null,
    ...input,
  };
}

function createPrismaMock() {
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        timezone: "Asia/Singapore",
      }),
    },
    trip: { findMany: jest.fn().mockResolvedValue([]) },
    tripPayoutLine: { findMany: jest.fn().mockResolvedValue([]) },
    tripDocument: { findMany: jest.fn().mockResolvedValue([]) },
    job: { findMany: jest.fn().mockResolvedValue([]) },
    jobCharge: { groupBy: jest.fn().mockResolvedValue([]) },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    invoiceLineItem: { findMany: jest.fn().mockResolvedValue([]) },
    drivers: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

function service(prisma: ReturnType<typeof createPrismaMock>) {
  return new StatisticsExceptionsService(prisma as any);
}

function exceptionRow(
  key: StatisticsExceptionItemDto["key"],
  severity: StatisticsExceptionItemDto["severity"],
  timestamp: Date | null,
  entityId: string,
): StatisticsExceptionItemDto {
  return {
    key,
    severity,
    entityType: "TRIP",
    entityId,
    jobId: "job-1",
    tripId: entityId,
    invoiceId: null,
    reportingTimestamp: timestamp,
    explanation: "test",
    href: "/test",
    resolvableInOpsFlow: true,
    jobNo: null,
    tripRef: null,
    containerNo: null,
    customerName: null,
    driverName: null,
    invoiceNo: null,
  };
}

describe("StatisticsExceptionsService categories", () => {
  it("collects more than a normal page for one bounded export scan", async () => {
    const prisma = createPrismaMock();
    prisma.trip.findMany
      .mockResolvedValueOnce(
        Array.from({ length: 101 }, (_, index) =>
          trip({
            id: `trip-${String(index).padStart(3, "0")}`,
            status: TripStatus.CANCELLED,
          }),
        ),
      )
      .mockResolvedValueOnce([]);

    const result = await service(prisma).getExceptionsForExport(
      "tenant-1",
      query({ key: "ex_cancelled_trip" }),
      200,
    );

    expect(result.data).toHaveLength(101);
    expect(result.meta.total).toBe(101);
    expect(prisma.trip.findMany.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(
      prisma.trip.findMany.mock.calls.every(
        ([args]) => args.where.tenantId === "tenant-1",
      ),
    ).toBe(true);
    expect(
      prisma.trip.findMany.mock.calls.some(([args]) => args.take === 200),
    ).toBe(true);
  });

  it("emits missing-payout rows from canonical payout lines with all filters tenant-scoped", async () => {
    const prisma = createPrismaMock();
    prisma.trip.findMany.mockResolvedValue([trip()]);
    const result = await service(prisma).getExceptions(
      "tenant-1",
      query({
        key: "ex_trip_missing_payout",
        customerId: "customer-1",
        jobId: "job-1",
        tripId: "trip-1",
        driverId: "driver-1",
        vehicleId: "vehicle-1",
      }),
    );

    expect(result.data).toEqual([
      expect.objectContaining({
        key: "ex_trip_missing_payout",
        severity: "HIGH",
        entityType: "TRIP",
        entityId: "trip-1",
        jobId: "job-1",
        tripId: "trip-1",
        invoiceId: null,
        reportingTimestamp: new Date("2026-08-01T02:00:00.000Z"),
        resolvableInOpsFlow: true,
      }),
    ]);
    expect(prisma.trip.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: "tenant-1",
      jobId: "job-1",
      id: "trip-1",
      assignedDriverUserId: "driver-1",
      OR: [{ vehicleId: "vehicle-1" }, { fleetVehicleId: "vehicle-1" }],
      job: {
        is: {
          tenantId: "tenant-1",
          customerCompanyId: "customer-1",
        },
      },
    });
    expect(prisma.tripPayoutLine.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          tripId: { in: ["trip-1"] },
        },
      }),
    );
    expect(result.countsByKey).toContainEqual({
      key: "ex_trip_missing_payout",
      count: 1,
    });
  });

  it("emits document gaps from live completion rules, not stored Pickup DO JSON", async () => {
    const prisma = createPrismaMock();
    prisma.trip.findMany.mockResolvedValue([
      trip({ id: "trip-no-photo", completionRuleJson: null }),
      trip({
        id: "trip-photo-ok",
        completionRuleJson: {
          tripUploads: {
            minUploadCount: 1,
            allowedUploadTypes: [TripDocumentType.POD_SIGNATURE],
            requiredUploadTypesExact: [TripDocumentType.POD_SIGNATURE],
          },
        },
      }),
    ]);
    prisma.tripDocument.findMany.mockResolvedValue([
      {
        tripId: "trip-photo-ok",
        type: TripDocumentType.OTHER,
        isActive: true,
        generatedBySystem: false,
        isSigned: false,
        signedAt: null,
      },
    ]);

    const result = await service(prisma).getExceptions(
      "tenant-1",
      query({ key: "ex_trip_missing_required_docs" }),
    );
    expect(result.data.map((row) => row.entityId)).toEqual(["trip-no-photo"]);
    expect(result.meta.total).toBe(1);
    expect(prisma.tripDocument.findMany.mock.calls[0][0].where).toEqual({
      tenantId: "tenant-1",
      tripId: { in: ["trip-no-photo", "trip-photo-ok"] },
      isActive: true,
    });
  });

  it("separates historical inverted timestamps from closedAt-null snapshots", async () => {
    const prisma = createPrismaMock();
    prisma.trip.findMany
      .mockResolvedValueOnce([
        trip({
          id: "trip-inverted",
          startedAt: new Date("2026-08-01T03:00:00.000Z"),
          closedAt: new Date("2026-08-01T02:00:00.000Z"),
        }),
      ])
      .mockResolvedValueOnce([
        trip({ id: "trip-null", startedAt: null, closedAt: null }),
      ]);

    const result = await service(prisma).getExceptions(
      "tenant-1",
      query({
        key: "ex_invalid_timestamps",
        sortBy: "reportingTimestamp",
        sortDir: "asc",
      }),
    );
    expect(result.data).toEqual([
      expect.objectContaining({
        entityId: "trip-inverted",
        reportingTimestamp: new Date("2026-08-01T02:00:00.000Z"),
        resolvableInOpsFlow: false,
      }),
      expect.objectContaining({
        entityId: "trip-null",
        reportingTimestamp: null,
        resolvableInOpsFlow: false,
      }),
    ]);
    expect(prisma.trip.findMany.mock.calls[0][0].where.closedAt).toEqual({
      gte: new Date("2026-07-31T16:00:00.000Z"),
      lt: new Date("2026-08-01T16:00:00.000Z"),
    });
    expect(prisma.trip.findMany.mock.calls[1][0].where.closedAt).toBeNull();
    expect(prisma.trip.findMany.mock.calls[1][0].where).not.toHaveProperty(
      "updatedAt",
    );
  });

  it("uses one request time and the inclusive stale boundary as a current snapshot", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-08-05T12:00:00.000Z"));
    try {
      const prisma = createPrismaMock();
      prisma.trip.findMany.mockResolvedValue([
        trip({
          status: TripStatus.PUBLISHED,
          plannedStartAt: new Date("2026-08-02T12:00:00.000Z"),
          updatedAt: new Date("2026-08-05T11:00:00.000Z"),
        }),
      ]);
      const result = await service(prisma).getExceptions(
        "tenant-1",
        query({ key: "ex_stale_operational_work" }),
      );
      expect(result.meta.total).toBe(1);
      expect(result.data[0].reportingTimestamp).toBeNull();
      const where = prisma.trip.findMany.mock.calls[0][0].where;
      expect(where.status).toEqual({
        in: [TripStatus.PUBLISHED, TripStatus.ONGOING],
      });
      expect(where).not.toHaveProperty("closedAt");
      expect(where).not.toHaveProperty("updatedAt");
      expect(result.generatedAt).toEqual(new Date("2026-08-05T12:00:00.000Z"));
    } finally {
      jest.useRealTimers();
    }
  });

  it("uses updatedAt only for the approved cancelled-trip cohort", async () => {
    const prisma = createPrismaMock();
    prisma.trip.findMany.mockResolvedValue([
      trip({
        status: TripStatus.CANCELLED,
        updatedAt: new Date("2026-08-01T03:00:00.000Z"),
      }),
    ]);
    const result = await service(prisma).getExceptions(
      "tenant-1",
      query({ key: "ex_cancelled_trip" }),
    );
    expect(result.data[0]).toMatchObject({
      key: "ex_cancelled_trip",
      severity: "LOW",
      reportingTimestamp: new Date("2026-08-01T03:00:00.000Z"),
      resolvableInOpsFlow: false,
      href: "/jobs/job-1",
    });
    expect(prisma.trip.findMany.mock.calls[0][0].where.updatedAt).toEqual({
      gte: new Date("2026-07-31T16:00:00.000Z"),
      lt: new Date("2026-08-01T16:00:00.000Z"),
    });
  });

  it("emits ready-not-invoiced only for jobs without recognized invoices", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany.mockResolvedValue([
      {
        id: "job-open",
        invoiceReadyAt: new Date("2026-08-01T04:00:00.000Z"),
      },
      {
        id: "job-invoiced",
        invoiceReadyAt: new Date("2026-08-01T05:00:00.000Z"),
      },
    ]);
    prisma.invoice.findMany.mockResolvedValue([
      { sourceJobId: "job-invoiced" },
    ]);
    const result = await service(prisma).getExceptions(
      "tenant-1",
      query({ key: "ex_ready_not_invoiced" }),
    );
    expect(result.data.map((row) => row.entityId)).toEqual(["job-open"]);
    expect(prisma.job.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: "tenant-1",
      status: "READY_FOR_INVOICE",
      invoiceReadyAt: {
        gte: new Date("2026-07-31T16:00:00.000Z"),
        lt: new Date("2026-08-01T16:00:00.000Z"),
      },
    });
    expect(prisma.invoice.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: "tenant-1",
      sourceJobId: { in: ["job-open", "job-invoiced"] },
      status: { in: ["Sent", "Issued", "Paid"] },
    });
  });

  it("emits missing-charge and excluded-profit as distinct job exceptions", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "job-1" }]);
    prisma.trip.findMany
      .mockResolvedValueOnce([trip({ id: "trip-1", jobId: "job-1" })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([trip({ id: "trip-1", jobId: "job-1" })]);
    prisma.jobCharge.groupBy.mockResolvedValue([]);
    prisma.tripPayoutLine.findMany.mockResolvedValue([]);

    const result = await service(prisma).getExceptions("tenant-1", query());
    const jobRows = result.data.filter((row) => row.entityId === "job-1");
    expect(jobRows.map((row) => row.key)).toEqual(
      expect.arrayContaining([
        "ex_job_missing_charges",
        "ex_excluded_from_profit",
      ]),
    );
    expect(new Set(jobRows.map((row) => row.key)).size).toBe(2);
    expect(prisma.jobCharge.groupBy.mock.calls[0][0].where).toEqual({
      tenantId: "tenant-1",
      jobId: { in: ["job-1"] },
    });
    expect(prisma.job.findMany.mock.calls[1][0].where.AND).toContainEqual({
      status: { not: "CANCELLED" },
    });
  });

  it("suppresses financial job exceptions when canonical records are complete", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany.mockResolvedValue([{ id: "job-1" }]);
    prisma.trip.findMany.mockResolvedValue([
      trip({ id: "trip-1", jobId: "job-1" }),
    ]);
    prisma.jobCharge.groupBy.mockResolvedValue([
      {
        jobId: "job-1",
        currency: "SGD",
        _sum: { amountCents: 1_000 },
      },
    ]);
    prisma.tripPayoutLine.findMany.mockResolvedValue([
      {
        tripId: "trip-1",
        totalCents: 100,
        amountCents: null,
        quantity: 1,
        isSelectableForTripEarning: true,
      },
    ]);
    const excludedResult = await service(prisma).getExceptions(
      "tenant-1",
      query({ key: "ex_excluded_from_profit" }),
    );
    expect(excludedResult.data).toEqual([]);

    const missingChargePrisma = createPrismaMock();
    missingChargePrisma.job.findMany.mockResolvedValue([{ id: "job-1" }]);
    missingChargePrisma.trip.findMany.mockResolvedValue([
      trip({ id: "trip-1", jobId: "job-1" }),
    ]);
    missingChargePrisma.jobCharge.groupBy.mockResolvedValue([
      {
        jobId: "job-1",
        currency: "SGD",
        _sum: { amountCents: 1_000 },
      },
    ]);
    const missingChargeResult = await service(
      missingChargePrisma,
    ).getExceptions("tenant-1", query({ key: "ex_job_missing_charges" }));
    expect(missingChargeResult.data).toEqual([]);
  });

  it("detects recognized invoices with missing tenant job links", async () => {
    const prisma = createPrismaMock();
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: "invoice-1",
        sourceJobId: "foreign-job",
        snapshot: { sourceJobIds: ["foreign-job"] },
        issuedAt: new Date("2026-08-01T03:00:00.000Z"),
        sentAt: null,
        issueDate: new Date("2026-08-01T01:00:00.000Z"),
      },
    ]);
    prisma.invoiceLineItem.findMany.mockResolvedValue([]);
    prisma.job.findMany.mockResolvedValue([]);
    const result = await service(prisma).getExceptions(
      "tenant-1",
      query({ key: "ex_orphan_invoice_job_link" }),
    );
    expect(result.data[0]).toMatchObject({
      key: "ex_orphan_invoice_job_link",
      entityType: "INVOICE",
      entityId: "invoice-1",
      invoiceId: "invoice-1",
      jobId: null,
      reportingTimestamp: new Date("2026-08-01T03:00:00.000Z"),
    });
    for (const call of prisma.invoice.findMany.mock.calls) {
      expect(call[0].where.tenantId).toBe("tenant-1");
    }
    expect(prisma.job.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: "tenant-1",
      id: { in: ["foreign-job"] },
    });
  });

  it("keeps null-sourceJobId orphans visible under trip filters via line linkage", async () => {
    const prisma = createPrismaMock();
    prisma.job.findMany.mockResolvedValue([{ id: "job-1" }]);
    prisma.trip.findMany.mockResolvedValue([{ id: "trip-1", jobId: "job-1" }]);
    prisma.invoice.findMany.mockResolvedValue([
      {
        id: "invoice-orphan",
        sourceJobId: null,
        snapshot: null,
        issuedAt: new Date("2026-08-01T03:00:00.000Z"),
        sentAt: null,
        issueDate: new Date("2026-08-01T01:00:00.000Z"),
      },
    ]);
    prisma.invoiceLineItem.findMany.mockResolvedValue([
      { invoiceId: "invoice-orphan", sourceTripId: "trip-1" },
    ]);

    const result = await service(prisma).getExceptions(
      "tenant-1",
      query({
        key: "ex_orphan_invoice_job_link",
        tripId: "trip-1",
      }),
    );

    expect(result.data.map((row) => row.entityId)).toEqual(["invoice-orphan"]);
    const invoiceWhere = prisma.invoice.findMany.mock.calls[0][0].where;
    expect(invoiceWhere.tenantId).toBe("tenant-1");
    expect(invoiceWhere.OR).toEqual(
      expect.arrayContaining([
        { sourceJobId: { in: ["job-1"] } },
        {
          sourceJobId: null,
          lineItems: {
            some: {
              tenantId: "tenant-1",
              sourceTripId: { in: ["trip-1"] },
            },
          },
        },
      ]),
    );
  });
});

describe("Exceptions sorting, pagination, and isolation", () => {
  const high = exceptionRow(
    "ex_trip_missing_payout",
    "HIGH",
    new Date("2026-08-01T01:00:00Z"),
    "trip-high",
  );
  const medium = exceptionRow(
    "ex_stale_operational_work",
    "MEDIUM",
    null,
    "trip-medium",
  );
  const low = exceptionRow(
    "ex_cancelled_trip",
    "LOW",
    new Date("2026-08-01T03:00:00Z"),
    "trip-low",
  );

  it.each([
    ["severity", "desc", high, medium],
    ["severity", "asc", low, medium],
    ["reportingTimestamp", "asc", high, low],
    ["reportingTimestamp", "desc", low, high],
    ["key", "asc", low, medium],
    ["key", "desc", high, medium],
  ] as const)(
    "sorts %s %s with approved semantics",
    (sortBy, sortDir, first, second) => {
      const rows = [medium, low, high].sort((left, right) =>
        compareExceptions(left, right, sortBy, sortDir),
      );
      expect(rows[0]).toBe(first);
      expect(rows[1]).toBe(second);
    },
  );

  it("uses canonical identity as the deterministic tie-breaker", () => {
    const laterIdentity = { ...high, entityId: "trip-z", tripId: "trip-z" };
    const earlierIdentity = {
      ...high,
      entityId: "trip-a",
      tripId: "trip-a",
    };
    expect(
      [laterIdentity, earlierIdentity]
        .sort((left, right) =>
          compareExceptions(left, right, "severity", "desc"),
        )
        .map((row) => row.entityId),
    ).toEqual(["trip-a", "trip-z"]);
  });

  it("returns correct totals and an empty beyond-final page", async () => {
    const prisma = createPrismaMock();
    prisma.trip.findMany.mockResolvedValue([
      trip({
        id: "cancelled-1",
        status: TripStatus.CANCELLED,
      }),
      trip({
        id: "cancelled-2",
        status: TripStatus.CANCELLED,
      }),
    ]);
    const result = await service(prisma).getExceptions(
      "tenant-1",
      query({
        key: "ex_cancelled_trip",
        page: 3,
        pageSize: 1,
      }),
    );
    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({ page: 3, pageSize: 1, total: 2 });
    expect(result.countsByKey).toContainEqual({
      key: "ex_cancelled_trip",
      count: 2,
    });
  });

  it("falls back safely for malicious direct-call sort values", async () => {
    const prisma = createPrismaMock();
    prisma.trip.findMany.mockResolvedValue([
      trip({ status: TripStatus.CANCELLED }),
    ]);
    const malicious = 'severity"; DROP TABLE trips; --';
    const result = await service(prisma).getExceptions(
      "tenant-1",
      query({
        key: "ex_cancelled_trip",
        sortBy: malicious as never,
        sortDir: malicious as never,
      }),
    );
    expect(result.meta.total).toBe(1);
    expect(JSON.stringify(prisma.trip.findMany.mock.calls)).not.toContain(
      "DROP TABLE",
    );
  });

  it("uses bounded category scans and introduces no raw SQL", async () => {
    const prisma = createPrismaMock();
    prisma.trip.findMany.mockResolvedValue([
      trip({ status: TripStatus.CANCELLED }),
    ]);
    await service(prisma).getExceptions(
      "tenant-1",
      query({ key: "ex_cancelled_trip" }),
    );
    expect(prisma.trip.findMany.mock.calls[0][0].take).toBe(200);

    const source = readFileSync(
      join(__dirname, "statistics-exceptions.service.ts"),
      "utf8",
    );
    expect(source).not.toContain("$queryRaw");
    expect(source).not.toContain("$queryRawUnsafe");
    expect(source).not.toContain("driverEarningCents");
    expect(source).not.toContain("currencyGroups");
    expect(source).not.toContain("grossProfitCents");
  });
});
