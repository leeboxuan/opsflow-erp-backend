import { Prisma } from "@prisma/client";
import { COMPLETED_TRIP_STATUSES } from "./statistics.constants";
import { StatisticsFiltersQueryDto } from "./dto";

function containerMatch(
  tenantId: string,
  containerNo: string,
): Prisma.TripJobItemWhereInput {
  return {
    tenantId,
    OR: [
      {
        containerNumberSnapshot: {
          equals: containerNo,
          mode: "insensitive",
        },
      },
      {
        jobItem: {
          is: {
            tenantId,
            itemCode: { equals: containerNo, mode: "insensitive" },
          },
        },
      },
    ],
  };
}

/**
 * Tenant-scoped trip filter shared by Statistics surfaces.
 * Legacy transport-order trips (jobId null) are excluded.
 */
export function buildStatisticsTripScope(
  tenantId: string,
  query: StatisticsFiltersQueryDto,
): Prisma.TripWhereInput {
  return {
    tenantId,
    jobId: query.jobId ?? { not: null },
    ...(query.tripId ? { id: query.tripId } : {}),
    ...(query.driverId ? { assignedDriverUserId: query.driverId } : {}),
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
        ...(query.customerId ? { customerCompanyId: query.customerId } : {}),
      },
    },
    ...(query.containerNo
      ? { tripJobItems: { some: containerMatch(tenantId, query.containerNo) } }
      : {}),
  };
}

export function buildStatisticsJobScope(
  tenantId: string,
  query: StatisticsFiltersQueryDto,
): Prisma.JobWhereInput {
  const matchingTrip =
    query.tripId || query.driverId || query.vehicleId || query.containerNo
      ? {
          tenantId,
          ...(query.tripId ? { id: query.tripId } : {}),
          ...(query.driverId
            ? { assignedDriverUserId: query.driverId }
            : {}),
          ...(query.vehicleId
            ? {
                OR: [
                  { vehicleId: query.vehicleId },
                  { fleetVehicleId: query.vehicleId },
                ],
              }
            : {}),
          ...(query.containerNo
            ? {
                tripJobItems: {
                  some: containerMatch(tenantId, query.containerNo),
                },
              }
            : {}),
        }
      : null;
  return {
    tenantId,
    ...(query.jobId ? { id: query.jobId } : {}),
    ...(query.customerId ? { customerCompanyId: query.customerId } : {}),
    ...(matchingTrip ? { trips: { some: matchingTrip } } : {}),
  };
}

/**
 * Authoritative container-movement predicate:
 * a TripJobItem linked to a non-cancelled completed trip whose closedAt
 * falls in the reporting window.
 */
export function buildContainerMovementWhere(
  tenantId: string,
  query: StatisticsFiltersQueryDto,
  range: { gte: Date; lt: Date },
): Prisma.TripJobItemWhereInput {
  return {
    tenantId,
    ...(query.containerNo ? containerMatch(tenantId, query.containerNo) : {}),
    trip: {
      is: {
        ...buildStatisticsTripScope(tenantId, query),
        status: { in: [...COMPLETED_TRIP_STATUSES] },
        closedAt: { gte: range.gte, lt: range.lt },
      },
    },
  };
}
