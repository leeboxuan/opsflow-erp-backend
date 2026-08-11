import { JobStatus, Prisma, TripStatus } from "@prisma/client";
import {
  ACTIVE_TRIP_STATUSES,
  COMPLETED_TRIP_STATUSES,
} from "../statistics/statistics.constants";

export type DashboardCompletionRateBasis = {
  completed: number;
  scheduled: number;
};

export type DashboardKpis = {
  jobsInPeriod: number;
  tripsInProgress: number;
  tripsCompletedInPeriod: number;
  pendingDriverAssignment: number;
  readyToInvoiceNotInvoiced: number;
  completionRate: number | null;
  completionRateBasis: DashboardCompletionRateBasis;
};

export function buildCompletionRate(
  completed: number,
  scheduled: number,
): Pick<DashboardKpis, "completionRate" | "completionRateBasis"> {
  return {
    completionRate: scheduled === 0 ? null : completed / scheduled,
    completionRateBasis: { completed, scheduled },
  };
}

export function buildDashboardKpis(input: {
  jobsInPeriod: number;
  tripsInProgress: number;
  tripsCompletedInPeriod: number;
  pendingDriverAssignment: number;
  readyToInvoiceNotInvoiced: number;
  scheduledTripsInPeriod: number;
  completedScheduledTripsInPeriod: number;
}): DashboardKpis {
  const rate = buildCompletionRate(
    input.completedScheduledTripsInPeriod,
    input.scheduledTripsInPeriod,
  );
  return {
    jobsInPeriod: input.jobsInPeriod,
    tripsInProgress: input.tripsInProgress,
    tripsCompletedInPeriod: input.tripsCompletedInPeriod,
    pendingDriverAssignment: input.pendingDriverAssignment,
    readyToInvoiceNotInvoiced: input.readyToInvoiceNotInvoiced,
    completionRate: rate.completionRate,
    completionRateBasis: rate.completionRateBasis,
  };
}

/** Jobs in period: pickupDate in range, else createdAt when pickupDate is null. */
export function buildJobsInPeriodWhere(
  tenantId: string,
  range: { gte: Date; lt: Date },
): Prisma.JobWhereInput {
  return {
    tenantId,
    status: { not: JobStatus.CANCELLED },
    OR: [
      { pickupDate: { gte: range.gte, lt: range.lt } },
      {
        AND: [
          { pickupDate: null },
          { createdAt: { gte: range.gte, lt: range.lt } },
        ],
      },
    ],
  };
}

export function buildTripsInProgressWhere(
  tenantId: string,
): Prisma.TripWhereInput {
  return {
    tenantId,
    jobId: { not: null },
    status: { in: [...ACTIVE_TRIP_STATUSES] },
  };
}

export function buildTripsCompletedInPeriodWhere(
  tenantId: string,
  range: { gte: Date; lt: Date },
): Prisma.TripWhereInput {
  return {
    tenantId,
    jobId: { not: null },
    status: { in: [...COMPLETED_TRIP_STATUSES] },
    closedAt: { gte: range.gte, lt: range.lt },
  };
}

export function buildPendingDriverAssignmentWhere(
  tenantId: string,
): Prisma.TripWhereInput {
  return {
    tenantId,
    jobId: { not: null },
    status: {
      notIn: [
        TripStatus.COMPLETED,
        TripStatus.DONE,
        TripStatus.CANCELLED,
      ],
    },
    assignedDriverUserId: null,
    driverId: null,
  };
}

/**
 * Scheduled cohort for completion rate (not the closedAt-based completed KPI).
 */
export function buildScheduledTripsInPeriodWhere(
  tenantId: string,
  range: { gte: Date; lt: Date },
): Prisma.TripWhereInput {
  return {
    tenantId,
    jobId: { not: null },
    status: { not: TripStatus.CANCELLED },
    OR: [
      { plannedStartAt: { gte: range.gte, lt: range.lt } },
      {
        AND: [
          { plannedStartAt: null },
          { createdAt: { gte: range.gte, lt: range.lt } },
        ],
      },
    ],
  };
}

export function buildCompletedScheduledTripsInPeriodWhere(
  tenantId: string,
  range: { gte: Date; lt: Date },
): Prisma.TripWhereInput {
  return {
    ...buildScheduledTripsInPeriodWhere(tenantId, range),
    status: { in: [...COMPLETED_TRIP_STATUSES] },
  };
}
