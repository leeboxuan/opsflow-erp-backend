import { Injectable } from "@nestjs/common";
import { Prisma, TripDocumentType, TripStatus } from "@prisma/client";
import {
  buildPaginationMeta,
  parsePaginationFromQuery,
} from "../shared/common/pagination";
import { PrismaService } from "../shared/prisma/prisma.service";
import { resolveTripCompletionRule } from "../transport/workflows/job-workflow.helpers";
import {
  StatisticsDriverRowDto,
  StatisticsDriversDto,
  StatisticsDriversQueryDto,
} from "./dto";
import {
  ACTIVE_TRIP_STATUSES,
  COMPLETED_TRIP_STATUSES,
  STATISTICS_DRIVER_LIMITATIONS,
  STATISTICS_DRIVER_ROW_LIMITATIONS,
  StatisticsDriverSortField,
} from "./statistics.constants";
import { resolveStatisticsDateRange } from "./statistics-date-range";
import { evaluateRequiredDocumentCompletion } from "./statistics.predicates";

type DriverAggregateRawRow = {
  driverUserId: string | null;
  completedTrips: bigint | number | null;
  completedJobs: bigint | number | null;
  totalValidDurationMs: bigint | number | null;
  validDurationTripCount: bigint | number | null;
  invalidDurationTripCount: bigint | number | null;
  avgDurationMs: bigint | number | null;
  activeAssignments: bigint | number | null;
  totalRows: bigint | number;
};

type CompletedTripForDocuments = {
  id: string;
  assignedDriverUserId: string | null;
  completionRuleJson: Prisma.JsonValue | null;
};

const DRIVER_SORT_SQL: Record<StatisticsDriverSortField, Prisma.Sql> = {
  completedTrips: Prisma.raw('r."completedTrips"'),
  avgDurationMs: Prisma.raw('r."avgDurationMs"'),
};

const DRIVER_SORT_DIRECTION_SQL = {
  asc: Prisma.raw("ASC"),
  desc: Prisma.raw("DESC"),
} as const;

function safeInteger(value: bigint | number | null | undefined): number {
  if (value == null) return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new RangeError("Statistics aggregate exceeds the safe integer range");
  }
  return number;
}

function nullableSafeInteger(
  value: bigint | number | null | undefined,
): number | null {
  return value == null ? null : safeInteger(value);
}

function driverAggregateFilters(
  tenantId: string,
  query: StatisticsDriversQueryDto,
): Prisma.Sql {
  const filters: Prisma.Sql[] = [
    Prisma.sql`t."tenantId" = ${tenantId}`,
    Prisma.sql`t."jobId" IS NOT NULL`,
    Prisma.sql`t."assignedDriverUserId" IS NOT NULL`,
    Prisma.sql`EXISTS (
      SELECT 1
      FROM "jobs" j
      WHERE j."id" = t."jobId"
        AND j."tenantId" = ${tenantId}
        ${
          query.customerId
            ? Prisma.sql`AND j."customerCompanyId" = ${query.customerId}`
            : Prisma.empty
        }
    )`,
  ];
  if (query.jobId) {
    filters.push(Prisma.sql`t."jobId" = ${query.jobId}`);
  }
  if (query.tripId) {
    filters.push(Prisma.sql`t."id" = ${query.tripId}`);
  }
  if (query.driverId) {
    filters.push(
      Prisma.sql`t."assignedDriverUserId" = ${query.driverId}`,
    );
  }
  if (query.vehicleId) {
    filters.push(
      Prisma.sql`(
        t."vehicleId" = ${query.vehicleId}
        OR t."fleetVehicleId" = ${query.vehicleId}
      )`,
    );
  }
  return Prisma.join(filters, " AND ");
}

/**
 * The single approved raw-SQL boundary for Driver Statistics. It performs
 * tenant-scoped row discovery, operational aggregation, sorting, total count,
 * and pagination. All user values remain Prisma parameters; only allowlisted
 * static sort fragments are emitted as SQL.
 */
export function buildDriverAggregateSql(input: {
  tenantId: string;
  query: StatisticsDriversQueryDto;
  range: { gte: Date; lt: Date };
  skip: number;
  take: number;
}): Prisma.Sql {
  const { tenantId, query, range, skip, take } = input;
  const filters = driverAggregateFilters(tenantId, query);
  const sortBy: StatisticsDriverSortField =
    query.sortBy === "avgDurationMs"
      ? "avgDurationMs"
      : "completedTrips";
  const sortDirection =
    query.sortDir === "asc" ? "asc" : "desc";
  const orderExpression = DRIVER_SORT_SQL[sortBy];
  const orderDirection = DRIVER_SORT_DIRECTION_SQL[sortDirection];
  const pageEnd = skip + take;

  return Prisma.sql`
    WITH completed AS (
      SELECT
        t."assignedDriverUserId" AS "driverUserId",
        COUNT(*)::bigint AS "completedTrips",
        COUNT(DISTINCT t."jobId")::bigint AS "completedJobs",
        COALESCE(
          SUM(
            CASE
              WHEN t."startedAt" IS NOT NULL
                AND t."closedAt" >= t."startedAt"
              THEN ROUND(
                EXTRACT(EPOCH FROM (t."closedAt" - t."startedAt")) * 1000
              )::bigint
              ELSE 0
            END
          ),
          0
        )::bigint AS "totalValidDurationMs",
        COUNT(*) FILTER (
          WHERE t."startedAt" IS NOT NULL
            AND t."closedAt" >= t."startedAt"
        )::bigint AS "validDurationTripCount",
        COUNT(*) FILTER (
          WHERE t."startedAt" IS NULL
            OR t."closedAt" < t."startedAt"
        )::bigint AS "invalidDurationTripCount"
      FROM "trips" t
      WHERE ${filters}
        AND t."status" IN (
          ${COMPLETED_TRIP_STATUSES[0]}::"TripStatus",
          ${COMPLETED_TRIP_STATUSES[1]}::"TripStatus"
        )
        AND t."closedAt" IS NOT NULL
        AND t."closedAt" >= ${range.gte}
        AND t."closedAt" < ${range.lt}
      GROUP BY t."assignedDriverUserId"
    ),
    active AS (
      SELECT
        t."assignedDriverUserId" AS "driverUserId",
        COUNT(*)::bigint AS "activeAssignments"
      FROM "trips" t
      WHERE ${filters}
        AND t."status" IN (
          ${ACTIVE_TRIP_STATUSES[0]}::"TripStatus",
          ${ACTIVE_TRIP_STATUSES[1]}::"TripStatus"
        )
      GROUP BY t."assignedDriverUserId"
    ),
    eligible AS (
      SELECT "driverUserId" FROM completed
      UNION
      SELECT "driverUserId" FROM active
    ),
    rows AS (
      SELECT
        e."driverUserId",
        COALESCE(c."completedTrips", 0)::bigint AS "completedTrips",
        COALESCE(c."completedJobs", 0)::bigint AS "completedJobs",
        COALESCE(c."totalValidDurationMs", 0)::bigint
          AS "totalValidDurationMs",
        COALESCE(c."validDurationTripCount", 0)::bigint
          AS "validDurationTripCount",
        COALESCE(c."invalidDurationTripCount", 0)::bigint
          AS "invalidDurationTripCount",
        CASE
          WHEN COALESCE(c."validDurationTripCount", 0) = 0 THEN NULL
          ELSE ROUND(
            c."totalValidDurationMs"::numeric
            / c."validDurationTripCount"::numeric
          )::bigint
        END AS "avgDurationMs",
        COALESCE(a."activeAssignments", 0)::bigint AS "activeAssignments"
      FROM eligible e
      LEFT JOIN completed c
        ON c."driverUserId" = e."driverUserId"
      LEFT JOIN active a
        ON a."driverUserId" = e."driverUserId"
    ),
    ordered AS (
      SELECT
        r.*,
        ROW_NUMBER() OVER (
          ORDER BY
            ${orderExpression} ${orderDirection} NULLS LAST,
            r."driverUserId" ASC
        )::bigint AS "pageOrder"
      FROM rows r
    ),
    totals AS (
      SELECT COUNT(*)::bigint AS "totalRows" FROM rows
    )
    SELECT
      o."driverUserId",
      o."completedTrips",
      o."completedJobs",
      o."totalValidDurationMs",
      o."validDurationTripCount",
      o."invalidDurationTripCount",
      o."avgDurationMs",
      o."activeAssignments",
      totals."totalRows"
    FROM totals
    LEFT JOIN ordered o
      ON o."pageOrder" > ${skip}
      AND o."pageOrder" <= ${pageEnd}
    ORDER BY o."pageOrder" ASC NULLS LAST
  `;
}

@Injectable()
export class StatisticsDriversService {
  constructor(private readonly prisma: PrismaService) {}

  async getDrivers(
    tenantId: string,
    query: StatisticsDriversQueryDto,
  ): Promise<StatisticsDriversDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const range = resolveStatisticsDateRange(
      { from: query.from, to: query.to },
      tenant?.timezone,
    );
    const pagination = parsePaginationFromQuery(query);
    const aggregateRows = (await this.prisma.$queryRaw(
      buildDriverAggregateSql({
        tenantId,
        query,
        range,
        skip: pagination.skip,
        take: pagination.take,
      }),
    )) as DriverAggregateRawRow[];
    const total = safeInteger(aggregateRows[0]?.totalRows);
    const pageRows = aggregateRows.filter(
      (row): row is DriverAggregateRawRow & { driverUserId: string } =>
        typeof row.driverUserId === "string",
    );
    const driverUserIds = pageRows.map((row) => row.driverUserId);

    if (driverUserIds.length === 0) {
      return {
        data: [],
        meta: buildPaginationMeta(
          pagination.page,
          pagination.pageSize,
          total,
        ),
        timeZone: range.timeZone,
        generatedAt: new Date(),
        limitations: [...STATISTICS_DRIVER_LIMITATIONS],
      };
    }

    const completedWhere = this.buildTripScope(
      tenantId,
      query,
      driverUserIds,
      {
        status: { in: [...COMPLETED_TRIP_STATUSES] },
        closedAt: { gte: range.gte, lt: range.lt },
      },
    );
    const cancelledWhere = this.buildTripScope(
      tenantId,
      query,
      driverUserIds,
      {
        status: TripStatus.CANCELLED,
        updatedAt: { gte: range.gte, lt: range.lt },
      },
    );
    const auditDriverFilters = driverUserIds.flatMap((driverUserId) => [
      {
        metadata: {
          path: ["oldDriverUserId"],
          equals: driverUserId,
        },
      },
      {
        metadata: {
          path: ["newDriverUserId"],
          equals: driverUserId,
        },
      },
    ]);

    const [driverProfiles, completedTrips, cancelledGroups, auditRows] =
      await Promise.all([
        this.prisma.drivers.findMany({
          where: {
            tenantId,
            userId: { in: driverUserIds },
          },
          select: { userId: true, name: true },
        }),
        this.prisma.trip.findMany({
          where: completedWhere,
          select: {
            id: true,
            assignedDriverUserId: true,
            completionRuleJson: true,
          },
        }),
        this.prisma.trip.groupBy({
          by: ["assignedDriverUserId"],
          where: cancelledWhere,
          _count: { _all: true },
        }),
        this.prisma.auditLog.findMany({
          where: {
            tenantId,
            entityType: "TRIP",
            action: "TRIP_DRIVER_REASSIGNED",
            createdAt: { gte: range.gte, lt: range.lt },
            OR: auditDriverFilters,
          },
          select: { id: true, metadata: true },
        }),
      ]);
    const typedDriverProfiles = driverProfiles as Array<{
      userId: string | null;
      name: string;
    }>;
    const typedCompletedTrips =
      completedTrips as CompletedTripForDocuments[];
    const typedCancelledGroups = cancelledGroups as Array<{
      assignedDriverUserId: string | null;
      _count: { _all: number };
    }>;
    const typedAuditRows = auditRows as Array<{
      id: string;
      metadata: Prisma.JsonValue | null;
    }>;

    const resolvableTrips = typedCompletedTrips.filter((trip) =>
      this.hasResolvableCompletionRule(trip.completionRuleJson),
    );
    const documents =
      resolvableTrips.length > 0
        ? await this.prisma.tripDocument.findMany({
            where: {
              tenantId,
              tripId: { in: resolvableTrips.map((trip) => trip.id) },
              isActive: true,
            },
            select: {
              tripId: true,
              type: true,
              isActive: true,
              generatedBySystem: true,
              isSigned: true,
              signedAt: true,
            },
          })
        : [];

    const names = new Map(
      typedDriverProfiles
        .filter(
          (profile): profile is typeof profile & { userId: string } =>
            typeof profile.userId === "string",
        )
        .map((profile) => [profile.userId, profile.name] as const),
    );
    const cancelledByDriver = new Map(
      typedCancelledGroups
        .filter(
          (group) => typeof group.assignedDriverUserId === "string",
        )
        .map((group) => [
          group.assignedDriverUserId as string,
          group._count._all,
        ]),
    );
    const reassignmentByDriver = this.buildReassignmentCounts(
      driverUserIds,
      typedAuditRows,
    );
    const documentRates = this.buildRequiredDocumentRates(
      driverUserIds,
      resolvableTrips,
      documents,
    );

    const data: StatisticsDriverRowDto[] = pageRows.map((row) => {
      const invalidDurationCount = safeInteger(
        row.invalidDurationTripCount,
      );
      const activeAssignments = safeInteger(row.activeAssignments);
      const documentRate = documentRates.get(row.driverUserId) ?? null;
      const limitations = [
        STATISTICS_DRIVER_ROW_LIMITATIONS.REASSIGNMENT_PARTIAL,
        ...(activeAssignments > 0
          ? [STATISTICS_DRIVER_ROW_LIMITATIONS.ACTIVE_SNAPSHOT]
          : []),
        ...(invalidDurationCount > 0
          ? [STATISTICS_DRIVER_ROW_LIMITATIONS.INVALID_DURATION]
          : []),
        ...(documentRate == null
          ? [
              STATISTICS_DRIVER_ROW_LIMITATIONS
                .DOCUMENT_RULES_UNAVAILABLE,
            ]
          : []),
      ];
      return {
        driverUserId: row.driverUserId,
        driverName: names.get(row.driverUserId) ?? null,
        completedTrips: safeInteger(row.completedTrips),
        completedJobs: safeInteger(row.completedJobs),
        totalValidDurationMs: safeInteger(row.totalValidDurationMs),
        avgDurationMs: nullableSafeInteger(row.avgDurationMs),
        cancelledTrips: cancelledByDriver.get(row.driverUserId) ?? 0,
        reassignmentCount:
          reassignmentByDriver.get(row.driverUserId) ?? 0,
        requiredDocumentCompletionRateBasisPoints: documentRate,
        limitations,
      };
    });

    return {
      data,
      meta: buildPaginationMeta(
        pagination.page,
        pagination.pageSize,
        total,
      ),
      timeZone: range.timeZone,
      generatedAt: new Date(),
      limitations: [...STATISTICS_DRIVER_LIMITATIONS],
    };
  }

  private buildTripScope(
    tenantId: string,
    query: StatisticsDriversQueryDto,
    driverUserIds: string[],
    metricWhere: Prisma.TripWhereInput,
  ): Prisma.TripWhereInput {
    return {
      tenantId,
      jobId: query.jobId ?? { not: null },
      assignedDriverUserId: { in: driverUserIds },
      ...(query.tripId ? { id: query.tripId } : {}),
      ...(query.vehicleId
        ? {
            OR: [
              { vehicleId: query.vehicleId },
              { fleetVehicleId: query.vehicleId },
            ],
          }
        : {}),
      job: {
        is: {
          tenantId,
          ...(query.customerId
            ? { customerCompanyId: query.customerId }
            : {}),
        },
      },
      ...metricWhere,
    };
  }

  private hasResolvableCompletionRule(raw: Prisma.JsonValue | null): boolean {
    const rule = resolveTripCompletionRule(raw);
    return (
      rule.requireGeneratedDoSigned === true ||
      rule.minUploadCount > 0 ||
      rule.requiredUploadTypesExact.length > 0
    );
  }

  private buildRequiredDocumentRates(
    driverUserIds: string[],
    trips: CompletedTripForDocuments[],
    documents: Array<{
      tripId: string;
      type: TripDocumentType;
      isActive: boolean;
      generatedBySystem: boolean;
      isSigned: boolean;
      signedAt: Date | null;
    }>,
  ): Map<string, number> {
    const documentsByTrip = new Map<string, typeof documents>();
    for (const document of documents) {
      const rows = documentsByTrip.get(document.tripId) ?? [];
      rows.push(document);
      documentsByTrip.set(document.tripId, rows);
    }
    const totals = new Map(
      driverUserIds.map((driverUserId) => [
        driverUserId,
        { complete: 0, resolvable: 0 },
      ]),
    );
    for (const trip of trips) {
      if (!trip.assignedDriverUserId) continue;
      const total = totals.get(trip.assignedDriverUserId);
      if (!total) continue;
      total.resolvable += 1;
      if (
        evaluateRequiredDocumentCompletion(
          trip.completionRuleJson,
          documentsByTrip.get(trip.id) ?? [],
        ).complete
      ) {
        total.complete += 1;
      }
    }
    return new Map(
      Array.from(totals)
        .filter(([, total]) => total.resolvable > 0)
        .map(([driverUserId, total]) => [
          driverUserId,
          Math.round(
            (total.complete * 10_000) / total.resolvable,
          ),
        ]),
    );
  }

  private buildReassignmentCounts(
    driverUserIds: string[],
    auditRows: Array<{ id: string; metadata: Prisma.JsonValue | null }>,
  ): Map<string, number> {
    const selected = new Set(driverUserIds);
    const counts = new Map<string, number>();
    for (const row of auditRows) {
      if (
        !row.metadata ||
        typeof row.metadata !== "object" ||
        Array.isArray(row.metadata)
      ) {
        continue;
      }
      const metadata = row.metadata as Record<string, unknown>;
      const involved = new Set(
        [metadata.oldDriverUserId, metadata.newDriverUserId].filter(
          (value): value is string =>
            typeof value === "string" && selected.has(value),
        ),
      );
      for (const driverUserId of involved) {
        counts.set(
          driverUserId,
          (counts.get(driverUserId) ?? 0) + 1,
        );
      }
    }
    return counts;
  }
}
