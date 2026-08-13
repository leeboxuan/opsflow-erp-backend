import { Prisma, TripDocumentType } from "@prisma/client";
import { StatisticsDriversQueryDto } from "./dto";
import {
  buildDriverAggregateSql,
  StatisticsDriversService,
} from "./statistics-drivers.service";

function makeQuery(
  input: Partial<StatisticsDriversQueryDto> = {},
): StatisticsDriversQueryDto {
  return Object.assign(new StatisticsDriversQueryDto(), {
    from: "2026-08-01",
    to: "2026-08-01",
    page: 1,
    pageSize: 20,
    sortBy: "completedTrips",
    sortDir: "desc",
    ...input,
  });
}

function rawRow(
  input: Partial<{
    driverUserId: string | null;
    completedTrips: bigint;
    completedJobs: bigint;
    totalValidDurationMs: bigint;
    validDurationTripCount: bigint;
    invalidDurationTripCount: bigint;
    avgDurationMs: bigint | null;
    activeAssignments: bigint;
    totalRows: bigint;
  }> = {},
) {
  return {
    driverUserId: "driver-1",
    completedTrips: 2n,
    completedJobs: 1n,
    totalValidDurationMs: 3_600_000n,
    validDurationTripCount: 1n,
    invalidDurationTripCount: 0n,
    avgDurationMs: 3_600_000n,
    activeAssignments: 0n,
    totalRows: 1n,
    ...input,
  };
}

function createPrismaMock(rows = [rawRow()]) {
  return {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        timezone: "Asia/Singapore",
      }),
    },
    drivers: {
      findMany: jest.fn().mockResolvedValue([
        { userId: "driver-1", name: "Driver One" },
      ]),
    },
    trip: {
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    tripJobItem: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    tripDocument: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };
}

function sqlText(statement: Prisma.Sql): string {
  return statement.sql.replace(/\s+/g, " ").trim();
}

describe("Driver aggregate SQL safety and semantics", () => {
  const range = {
    gte: new Date("2026-07-31T16:00:00.000Z"),
    lt: new Date("2026-08-01T16:00:00.000Z"),
  };

  it("uses mandatory tenant scope, canonical attribution, statuses, dates, and duration rules", () => {
    const statement = buildDriverAggregateSql({
      tenantId: "tenant-1",
      query: makeQuery(),
      range,
      skip: 0,
      take: 20,
    });
    const text = sqlText(statement);

    expect(text).toContain('t."tenantId" = ?');
    expect(text).toContain('j."tenantId" = ?');
    expect(text).toContain('t."assignedDriverUserId" IS NOT NULL');
    expect(text).toContain('GROUP BY t."assignedDriverUserId"');
    expect(text).toContain('t."closedAt" IS NOT NULL');
    expect(text).toContain('t."closedAt" >= ?');
    expect(text).toContain('t."closedAt" < ?');
    expect(statement.values).toEqual(
      expect.arrayContaining([
        "COMPLETED",
        "DONE",
        "PUBLISHED",
        "ONGOING",
      ]),
    );
    expect(text).toContain('t."startedAt" IS NOT NULL');
    expect(text).toContain('t."closedAt" >= t."startedAt"');
    expect(text).toContain('t."closedAt" < t."startedAt"');
    expect(text).toContain('COUNT(*)::bigint AS "totalRows"');
    expect(text).not.toContain("driverEarningCents");
    expect(text).not.toContain("TripPayoutLine");
    expect(statement.values).toContain("tenant-1");
    expect(statement.values).toContain(range.gte);
    expect(statement.values).toContain(range.lt);
  });

  it("keeps active assignments as an undated current snapshot", () => {
    const text = sqlText(
      buildDriverAggregateSql({
        tenantId: "tenant-1",
        query: makeQuery(),
        range,
        skip: 0,
        take: 20,
      }),
    );
    const completedSegment = text.slice(
      text.indexOf("WITH completed AS"),
      text.indexOf("active AS"),
    );
    const activeSegment = text.slice(
      text.indexOf("active AS"),
      text.indexOf("eligible AS"),
    );
    expect(completedSegment).toContain('t."closedAt" >= ?');
    expect(completedSegment).toContain('t."closedAt" < ?');
    expect(activeSegment).not.toContain('t."closedAt"');
  });

  it.each([
    ["customerId", "customer-1"],
    ["jobId", "job-1"],
    ["tripId", "trip-1"],
    ["driverId", "driver-1"],
    ["vehicleId", "vehicle-1"],
  ] as const)("parameterizes %s without embedding its value", (field, value) => {
    const statement = buildDriverAggregateSql({
      tenantId: "tenant-1",
      query: makeQuery({ [field]: value }),
      range,
      skip: 0,
      take: 20,
    });
    expect(statement.sql).not.toContain(value);
    expect(statement.values).toContain(value);
  });

  it("keeps standard/fleet vehicle predicates grouped with combined filters", () => {
    const statement = buildDriverAggregateSql({
      tenantId: "tenant-1",
      query: makeQuery({
        customerId: "customer-1",
        jobId: "job-1",
        tripId: "trip-1",
        driverId: "driver-1",
        vehicleId: "vehicle-1",
      }),
      range,
      skip: 20,
      take: 10,
    });
    const text = sqlText(statement);
    expect(text).toContain(
      '( t."vehicleId" = ? OR t."fleetVehicleId" = ? )',
    );
    for (const value of [
      "customer-1",
      "job-1",
      "trip-1",
      "driver-1",
      "vehicle-1",
    ]) {
      expect(statement.values).toContain(value);
    }
    expect(statement.values).toContain(20);
    expect(statement.values).toContain(30);
  });

  it.each([
    ["completedTrips", "asc", 'r."completedTrips" ASC'],
    ["completedTrips", "desc", 'r."completedTrips" DESC'],
    ["avgDurationMs", "asc", 'r."avgDurationMs" ASC'],
    ["avgDurationMs", "desc", 'r."avgDurationMs" DESC'],
  ] as const)("allowlists %s %s", (sortBy, sortDir, expected) => {
    const statement = buildDriverAggregateSql({
      tenantId: "tenant-1",
      query: makeQuery({ sortBy, sortDir }),
      range,
      skip: 0,
      take: 20,
    });
    const text = sqlText(statement);
    expect(text).toContain(expected);
    expect(text).toContain('r."driverUserId" ASC');
    expect(text).toContain("NULLS LAST");
  });

  it("falls back safely for malicious direct-call sort input", () => {
    const malicious = 'avgDurationMs"; DROP TABLE "trips"; --';
    const statement = buildDriverAggregateSql({
      tenantId: "tenant-1",
      query: makeQuery({
        sortBy: malicious as never,
        sortDir: malicious as never,
      }),
      range,
      skip: 0,
      take: 20,
    });
    const text = sqlText(statement);
    expect(text).toContain('r."completedTrips" DESC');
    expect(text).not.toContain("DROP TABLE");
    expect(statement.values).not.toContain(malicious);
  });
});

describe("StatisticsDriversService", () => {
  it("maps aggregated drivers and performs bounded tenant-scoped enrichment", async () => {
    const prisma = createPrismaMock([
      rawRow({
        driverUserId: "driver-1",
        completedTrips: 3n,
        completedJobs: 2n,
        totalValidDurationMs: 3_600_000n,
        validDurationTripCount: 2n,
        invalidDurationTripCount: 1n,
        avgDurationMs: 1_800_000n,
        activeAssignments: 1n,
        totalRows: 2n,
      }),
      rawRow({
        driverUserId: "driver-2",
        completedTrips: 0n,
        completedJobs: 0n,
        totalValidDurationMs: 0n,
        validDurationTripCount: 0n,
        invalidDurationTripCount: 0n,
        avgDurationMs: null,
        activeAssignments: 2n,
        totalRows: 2n,
      }),
    ]);
    prisma.drivers.findMany.mockResolvedValue([
      { userId: "driver-1", name: "Driver One" },
      { userId: "driver-2", name: "Driver Two" },
    ]);
    prisma.trip.findMany.mockResolvedValue([
      {
        id: "trip-1",
        assignedDriverUserId: "driver-1",
        completionRuleJson: {
          tripUploads: {
            minUploadCount: 1,
            allowedUploadTypes: [TripDocumentType.POD_SIGNATURE],
            requiredUploadTypesExact: [
              TripDocumentType.POD_SIGNATURE,
            ],
          },
        },
      },
    ]);
    prisma.trip.groupBy.mockResolvedValue([
      {
        assignedDriverUserId: "driver-1",
        _count: { _all: 1 },
      },
    ]);
    prisma.tripDocument.findMany.mockResolvedValue([
      {
        tripId: "trip-1",
        type: TripDocumentType.POD_SIGNATURE,
        isActive: true,
        generatedBySystem: false,
        isSigned: false,
        signedAt: null,
      },
    ]);
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: "audit-1",
        metadata: {
          oldDriverUserId: "driver-1",
          newDriverUserId: "driver-2",
        },
      },
    ]);
    const service = new StatisticsDriversService(prisma as any);

    const result = await service.getDrivers(
      "tenant-1",
      makeQuery({ pageSize: 2 }),
    );

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect((prisma as any).$queryRawUnsafe).toBeUndefined();
    expect(result.meta).toEqual({ page: 1, pageSize: 2, total: 2 });
    expect(result.timeZone).toBe("Asia/Singapore");
    expect(result.data).toEqual([
      expect.objectContaining({
        driverUserId: "driver-1",
        driverName: "Driver One",
        completedTrips: 3,
        completedJobs: 2,
        totalValidDurationMs: 3_600_000,
        avgDurationMs: 1_800_000,
        cancelledTrips: 1,
        reassignmentCount: 1,
        requiredDocumentCompletionRateBasisPoints: 10_000,
      }),
      expect.objectContaining({
        driverUserId: "driver-2",
        driverName: "Driver Two",
        completedTrips: 0,
        completedJobs: 0,
        totalValidDurationMs: 0,
        avgDurationMs: null,
        cancelledTrips: 0,
        reassignmentCount: 1,
        requiredDocumentCompletionRateBasisPoints: null,
      }),
    ]);
    expect(result.data[0].limitations).toEqual(
      expect.arrayContaining([
        "active_assignments_are_current_snapshot",
        "invalid_trip_durations_excluded",
        "reassignment_history_is_partial",
      ]),
    );
    expect(result.data[1].limitations).toContain(
      "required_document_rules_unavailable",
    );

    expect(prisma.drivers.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          userId: { in: ["driver-1", "driver-2"] },
        },
      }),
    );
    const completedWhere = prisma.trip.findMany.mock.calls[0][0].where;
    expect(completedWhere).toMatchObject({
      tenantId: "tenant-1",
      assignedDriverUserId: {
        in: ["driver-1", "driver-2"],
      },
      closedAt: {
        gte: new Date("2026-07-31T16:00:00.000Z"),
        lt: new Date("2026-08-01T16:00:00.000Z"),
      },
    });
    expect(prisma.tripDocument.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: "tenant-1",
          tripId: { in: ["trip-1"] },
          isActive: true,
        },
      }),
    );
    expect(prisma.auditLog.findMany.mock.calls[0][0].where).toMatchObject({
      tenantId: "tenant-1",
      action: "TRIP_DRIVER_REASSIGNED",
      entityType: "TRIP",
    });
    for (const row of result.data) {
      expect(row).not.toHaveProperty("currencyGroups");
      expect(row).not.toHaveProperty("recordedPayoutCents");
      expect(row).not.toHaveProperty("driverEarningCents");
    }
  });

  it("preserves zero duration and null when no duration is valid", async () => {
    const prisma = createPrismaMock([
      rawRow({
        driverUserId: "zero-driver",
        totalValidDurationMs: 0n,
        validDurationTripCount: 1n,
        avgDurationMs: 0n,
        totalRows: 2n,
      }),
      rawRow({
        driverUserId: "invalid-driver",
        totalValidDurationMs: 0n,
        validDurationTripCount: 0n,
        invalidDurationTripCount: 2n,
        avgDurationMs: null,
        totalRows: 2n,
      }),
    ]);
    prisma.drivers.findMany.mockResolvedValue([]);
    const result = await new StatisticsDriversService(
      prisma as any,
    ).getDrivers("tenant-1", makeQuery());

    expect(result.data[0].avgDurationMs).toBe(0);
    expect(result.data[1].avgDurationMs).toBeNull();
    expect(result.data[1].limitations).toContain(
      "invalid_trip_durations_excluded",
    );
  });

  it.each([
    ["customerId", "other-customer"],
    ["jobId", "other-job"],
    ["tripId", "other-trip"],
    ["driverId", "other-driver"],
    ["vehicleId", "other-vehicle"],
  ] as const)(
    "returns no rows for an unmatched tenant-scoped %s filter",
    async (field, value) => {
      const prisma = createPrismaMock([
        rawRow({ driverUserId: null, totalRows: 0n }),
      ]);
      const result = await new StatisticsDriversService(
        prisma as any,
      ).getDrivers("tenant-1", makeQuery({ [field]: value }));

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      const statement = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
      expect(statement.values).toContain("tenant-1");
      expect(statement.values).toContain(value);
      expect(prisma.drivers.findMany).not.toHaveBeenCalled();
    },
  );

  it("returns total metadata for a page beyond the end without enrichment", async () => {
    const prisma = createPrismaMock([
      rawRow({ driverUserId: null, totalRows: 7n }),
    ]);
    const result = await new StatisticsDriversService(
      prisma as any,
    ).getDrivers(
      "tenant-1",
      makeQuery({ page: 3, pageSize: 3 }),
    );

    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({ page: 3, pageSize: 3, total: 7 });
    expect(prisma.drivers.findMany).not.toHaveBeenCalled();
    const statement = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(statement.values).toContain(6);
    expect(statement.values).toContain(9);
  });

  it("contains no financial query surface", () => {
    const source = require("fs").readFileSync(__filename.replace(
      "statistics-drivers.service.spec.ts",
      "statistics-drivers.service.ts",
    ), "utf8");
    expect(source).not.toContain("$queryRawUnsafe");
    expect(source).not.toContain("tripPayoutLine");
    expect(source).not.toContain("driverEarningCents");
    expect(source).not.toContain("jobCharge");
    expect(source).not.toContain("invoice");
    expect(source).not.toContain("recordedPayoutCents");
  });
});
