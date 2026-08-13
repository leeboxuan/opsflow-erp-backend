import { Injectable } from "@nestjs/common";
import { Prisma, TripStatus } from "@prisma/client";
import { PrismaService } from "../shared/prisma/prisma.service";
import { StatisticsFiltersQueryDto, StatisticsOverviewDto } from "./dto";
import {
  ACTIVE_TRIP_STATUSES,
  COMPLETED_TRIP_STATUSES,
  STATISTICS_OVERVIEW_LIMITATIONS,
} from "./statistics.constants";
import {
  completedTripReportingTimestamp,
  isOperationallyCompletedJob,
} from "./statistics.predicates";
import { resolveStatisticsDateRange } from "./statistics-date-range";
import { buildStatisticsTripScope } from "./statistics-scope";
import { StatisticsTruckingService } from "./statistics-trucking.service";

/** Matches Finance/Exceptions bounded traversal. */
export const OVERVIEW_JOB_BATCH_SIZE = 200;
export const OVERVIEW_TRIP_BATCH_SIZE = 200;

type OperationalJobTripRow = {
  id: string;
  jobId: string | null;
  status: TripStatus;
  closedAt: Date | null;
};

@Injectable()
export class StatisticsOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trucking: StatisticsTruckingService,
  ) {}

  async getOverview(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Promise<StatisticsOverviewDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    const range = resolveStatisticsDateRange(
      { from: query.from, to: query.to },
      tenant?.timezone,
    );
    const tripScope = buildStatisticsTripScope(tenantId, query);

    const [
      completedTrips,
      activePendingTrips,
      cancelledTrips,
      operationallyCompletedJobs,
      truckingSummary,
    ] = await Promise.all([
      this.prisma.trip.count({
        where: {
          ...tripScope,
          status: { in: [...COMPLETED_TRIP_STATUSES] },
          closedAt: { gte: range.gte, lt: range.lt },
        },
      }),
      this.prisma.trip.count({
        where: {
          ...tripScope,
          status: { in: [...ACTIVE_TRIP_STATUSES] },
        },
      }),
      this.prisma.trip.count({
        where: {
          ...tripScope,
          status: TripStatus.CANCELLED,
          updatedAt: { gte: range.gte, lt: range.lt },
        },
      }),
      this.countOperationallyCompletedJobsBatched(tenantId, query, range),
      this.trucking.getSummary(tenantId, query),
    ]);

    return {
      timeZone: range.timeZone,
      generatedAt: new Date(),
      limitations: [
        ...STATISTICS_OVERVIEW_LIMITATIONS,
        "container_movement_uses_trip_job_item",
      ],
      completedTrips,
      operationallyCompletedJobs,
      activePendingTrips,
      cancelledTrips,
      uniqueContainers: truckingSummary.uniqueContainers,
      containerMovements: truckingSummary.containerMovements,
    };
  }

  /**
   * Job-grain candidate set equivalent to the prior distinct-jobId trip scan:
   * the job matches customer/job and optional trip/driver/vehicle presence,
   * and has at least one completed trip whose closedAt falls in range.
   */
  private buildOperationalCandidateJobScope(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
    range: { gte: Date; lt: Date },
  ): Prisma.JobWhereInput {
    const matchingTrip = this.buildJobMatchingTripScope(tenantId, query);
    const completedInRange: Prisma.TripWhereInput = {
      tenantId,
      status: { in: [...COMPLETED_TRIP_STATUSES] },
      closedAt: { gte: range.gte, lt: range.lt },
    };
    return {
      tenantId,
      ...(query.jobId ? { id: query.jobId } : {}),
      ...(query.customerId
        ? { customerCompanyId: query.customerId }
        : {}),
      AND: [
        ...(matchingTrip
          ? [{ trips: { some: matchingTrip } }]
          : []),
        { trips: { some: completedInRange } },
      ],
    };
  }

  private buildJobMatchingTripScope(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
  ): Prisma.TripWhereInput | null {
    if (
      !query.tripId &&
      !query.driverId &&
      !query.vehicleId &&
      !query.containerNo
    ) {
      return null;
    }
    return {
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
              some: {
                tenantId,
                OR: [
                  {
                    containerNumberSnapshot: {
                      equals: query.containerNo,
                      mode: "insensitive",
                    },
                  },
                  {
                    jobItem: {
                      is: {
                        tenantId,
                        itemCode: {
                          equals: query.containerNo,
                          mode: "insensitive",
                        },
                      },
                    },
                  },
                ],
              },
            },
          }
        : {}),
    };
  }

  /**
   * Walk candidate jobs in stable id order. Peak memory stays proportional to
   * one job batch plus its trip enrichment batches — never the full tenant set.
   */
  private async countOperationallyCompletedJobsBatched(
    tenantId: string,
    query: StatisticsFiltersQueryDto,
    range: { gte: Date; lt: Date },
  ): Promise<number> {
    let count = 0;
    let jobCursor: string | undefined;
    for (;;) {
      const jobs = (await this.prisma.job.findMany({
        where: this.buildOperationalCandidateJobScope(
          tenantId,
          query,
          range,
        ),
        orderBy: { id: "asc" },
        take: OVERVIEW_JOB_BATCH_SIZE,
        ...(jobCursor ? { cursor: { id: jobCursor }, skip: 1 } : {}),
        select: { id: true },
      })) as Array<{ id: string }>;
      if (jobs.length === 0) break;

      const jobIds = jobs.map((job) => job.id);
      const tripsByJob = await this.loadTripsForJobBatch(tenantId, jobIds);
      count += this.countOperationallyCompletedJobsInBatch(
        jobIds,
        tripsByJob,
        range,
      );

      jobCursor = jobs[jobs.length - 1].id;
      if (jobs.length < OVERVIEW_JOB_BATCH_SIZE) break;
    }
    return count;
  }

  private async loadTripsForJobBatch(
    tenantId: string,
    jobIds: string[],
  ): Promise<Map<string, OperationalJobTripRow[]>> {
    const tripsByJob = new Map<string, OperationalJobTripRow[]>();
    for (const jobId of jobIds) {
      tripsByJob.set(jobId, []);
    }

    let tripCursor: string | undefined;
    for (;;) {
      const trips = (await this.prisma.trip.findMany({
        where: {
          tenantId,
          jobId: { in: jobIds },
        },
        orderBy: { id: "asc" },
        take: OVERVIEW_TRIP_BATCH_SIZE,
        ...(tripCursor ? { cursor: { id: tripCursor }, skip: 1 } : {}),
        select: {
          id: true,
          jobId: true,
          status: true,
          closedAt: true,
        },
      })) as OperationalJobTripRow[];
      if (trips.length === 0) break;

      for (const trip of trips) {
        if (!trip.jobId) continue;
        const rows = tripsByJob.get(trip.jobId);
        if (!rows) continue;
        rows.push(trip);
      }

      tripCursor = trips[trips.length - 1].id;
      if (trips.length < OVERVIEW_TRIP_BATCH_SIZE) break;
    }

    return tripsByJob;
  }

  private countOperationallyCompletedJobsInBatch(
    jobIds: string[],
    tripsByJob: Map<string, OperationalJobTripRow[]>,
    range: { gte: Date; lt: Date },
  ): number {
    let count = 0;
    for (const jobId of jobIds) {
      const jobTrips = tripsByJob.get(jobId) ?? [];
      if (!isOperationallyCompletedJob(jobTrips)) continue;
      const reportingDates = jobTrips
        .filter((trip) => trip.status !== TripStatus.CANCELLED)
        .map((trip) => completedTripReportingTimestamp(trip))
        .filter((date): date is Date => date instanceof Date);
      if (reportingDates.length === 0) continue;
      const reportingTimestamp = new Date(
        Math.max(...reportingDates.map((date) => date.getTime())),
      );
      if (
        reportingTimestamp.getTime() >= range.gte.getTime() &&
        reportingTimestamp.getTime() < range.lt.getTime()
      ) {
        count += 1;
      }
    }
    return count;
  }
}
