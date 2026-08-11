import { JobStatus, TripStatus } from "@prisma/client";
import {
  buildCompletedScheduledTripsInPeriodWhere,
  buildCompletionRate,
  buildDashboardKpis,
  buildJobsInPeriodWhere,
  buildPendingDriverAssignmentWhere,
  buildScheduledTripsInPeriodWhere,
  buildTripsCompletedInPeriodWhere,
  buildTripsInProgressWhere,
} from "./dashboard-kpis";

describe("dashboard KPIs helpers", () => {
  const range = {
    gte: new Date("2026-08-10T16:00:00.000Z"),
    lt: new Date("2026-08-11T16:00:00.000Z"),
  };

  it("buildCompletionRate returns null when scheduled is zero", () => {
    expect(buildCompletionRate(0, 0)).toEqual({
      completionRate: null,
      completionRateBasis: { completed: 0, scheduled: 0 },
    });
  });

  it("buildCompletionRate uses the scheduled cohort numerator/denominator", () => {
    expect(buildCompletionRate(3, 4)).toEqual({
      completionRate: 0.75,
      completionRateBasis: { completed: 3, scheduled: 4 },
    });
  });

  it("buildDashboardKpis does not use tripsCompletedInPeriod as completion numerator", () => {
    const kpis = buildDashboardKpis({
      jobsInPeriod: 1,
      tripsInProgress: 2,
      tripsCompletedInPeriod: 99,
      pendingDriverAssignment: 0,
      readyToInvoiceNotInvoiced: 1,
      scheduledTripsInPeriod: 4,
      completedScheduledTripsInPeriod: 3,
    });
    expect(kpis.tripsCompletedInPeriod).toBe(99);
    expect(kpis.completionRate).toBe(0.75);
    expect(kpis.completionRateBasis).toEqual({ completed: 3, scheduled: 4 });
  });

  it("jobsInPeriod where keeps tenantId outside the OR and uses pickupDate/createdAt fallback", () => {
    const where = buildJobsInPeriodWhere("tenant-a", range);
    expect(where.tenantId).toBe("tenant-a");
    expect(where.status).toEqual({ not: JobStatus.CANCELLED });
    expect(where.OR).toEqual([
      { pickupDate: { gte: range.gte, lt: range.lt } },
      {
        AND: [
          { pickupDate: null },
          { createdAt: { gte: range.gte, lt: range.lt } },
        ],
      },
    ]);
  });

  it("tripsInProgress is snapshot active statuses with jobId required", () => {
    expect(buildTripsInProgressWhere("tenant-a")).toEqual({
      tenantId: "tenant-a",
      jobId: { not: null },
      status: { in: [TripStatus.PUBLISHED, TripStatus.ONGOING] },
    });
  });

  it("tripsCompletedInPeriod filters closedAt and completed statuses", () => {
    expect(buildTripsCompletedInPeriodWhere("tenant-a", range)).toEqual({
      tenantId: "tenant-a",
      jobId: { not: null },
      status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
      closedAt: { gte: range.gte, lt: range.lt },
    });
  });

  it("pendingDriverAssignment includes DRAFT and requires both driver fields null", () => {
    const where = buildPendingDriverAssignmentWhere("tenant-a");
    expect(where).toEqual({
      tenantId: "tenant-a",
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
    });
  });

  it("scheduled cohort uses plannedStartAt with createdAt fallback", () => {
    expect(buildScheduledTripsInPeriodWhere("tenant-a", range)).toEqual({
      tenantId: "tenant-a",
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
    });
  });

  it("completed scheduled where narrows the scheduled cohort to COMPLETED/DONE", () => {
    const where = buildCompletedScheduledTripsInPeriodWhere("tenant-a", range);
    expect(where.tenantId).toBe("tenant-a");
    expect(where.jobId).toEqual({ not: null });
    expect(where.status).toEqual({
      in: [TripStatus.COMPLETED, TripStatus.DONE],
    });
    expect(where.OR).toBeDefined();
  });
});
