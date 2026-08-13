import { TripStatus } from "@prisma/client";
import { StatisticsFiltersQueryDto } from "./dto";
import { STATISTICS_OVERVIEW_LIMITATIONS } from "./statistics.constants";
import {
  OVERVIEW_JOB_BATCH_SIZE,
  OVERVIEW_TRIP_BATCH_SIZE,
  StatisticsOverviewService,
} from "./statistics-overview.service";

type TripRow = {
  id: string;
  jobId: string;
  status: TripStatus;
  closedAt: Date | null;
};

type JobRow = { id: string };

function createPrismaMock(options?: {
  timezone?: string | null;
  completedCount?: number;
  activeCount?: number;
  cancelledCount?: number;
  candidateJobs?: JobRow[];
  candidateTrips?: TripRow[];
}) {
  const jobs = [...(options?.candidateJobs ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const trips = [...(options?.candidateTrips ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const trip = {
    count: jest.fn(async (args: any) => {
      const status = args.where.status;
      if (status === TripStatus.CANCELLED) {
        return options?.cancelledCount ?? 0;
      }
      if (status?.in?.includes(TripStatus.PUBLISHED)) {
        return options?.activeCount ?? 0;
      }
      return options?.completedCount ?? 0;
    }),
    findMany: jest.fn(async (args: any) => {
      const jobIds: string[] | undefined = args.where?.jobId?.in;
      let filtered = trips;
      if (jobIds) {
        const allowed = new Set(jobIds);
        filtered = trips.filter((row) => allowed.has(row.jobId));
      }
      const take: number = args.take ?? filtered.length;
      let start = 0;
      if (args.cursor?.id) {
        const index = filtered.findIndex((row) => row.id === args.cursor.id);
        start = index >= 0 ? index + (args.skip ?? 0) : filtered.length;
      }
      return filtered.slice(start, start + take);
    }),
  };

  const job = {
    findMany: jest.fn(async (args: any) => {
      const take: number = args.take ?? jobs.length;
      let start = 0;
      if (args.cursor?.id) {
        const index = jobs.findIndex((row) => row.id === args.cursor.id);
        start = index >= 0 ? index + (args.skip ?? 0) : jobs.length;
      }
      return jobs.slice(start, start + take);
    }),
  };

  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({
        timezone:
          options && "timezone" in options
            ? options.timezone
            : "UTC",
      }),
    },
    trip,
    job,
  };
}

function truckingStub(input: { uniqueContainers?: number; containerMovements?: number } = {}) {
  return {
    getSummary: jest.fn().mockResolvedValue({
      uniqueContainers: input.uniqueContainers ?? 0,
      containerMovements: input.containerMovements ?? 0,
      limitations: [],
    }),
  };
}

function createService(prisma: ReturnType<typeof createPrismaMock>, trucking = truckingStub()) {
  return new StatisticsOverviewService(prisma as any, trucking as any);
}

function query(input: Partial<StatisticsFiltersQueryDto> = {}) {
  return Object.assign(new StatisticsFiltersQueryDto(), {
    from: "2026-08-01",
    to: "2026-08-01",
    ...input,
  });
}

function completedTrip(
  id: string,
  jobId: string,
  closedAt: string,
  status: TripStatus = TripStatus.COMPLETED,
): TripRow {
  return {
    id,
    jobId,
    status,
    closedAt: new Date(closedAt),
  };
}

describe("StatisticsOverviewService", () => {
  it("returns only implemented operational metrics and stable limitations", async () => {
    const prisma = createPrismaMock({
      completedCount: 4,
      activeCount: 3,
      cancelledCount: 2,
      candidateJobs: [{ id: "job-1" }],
      candidateTrips: [
        completedTrip("trip-1", "job-1", "2026-08-01T12:00:00.000Z"),
      ],
    });
    const service = createService(prisma);

    const result = await service.getOverview("tenant-1", query());

    expect(result).toMatchObject({
      timeZone: "UTC",
      completedTrips: 4,
      operationallyCompletedJobs: 1,
      activePendingTrips: 3,
      cancelledTrips: 2,
      uniqueContainers: 0,
      containerMovements: 0,
      limitations: [
        ...STATISTICS_OVERVIEW_LIMITATIONS,
        "container_movement_uses_trip_job_item",
      ],
    });
    expect(result.generatedAt).toBeInstanceOf(Date);
    expect(result).not.toHaveProperty("currencyGroups");
    expect(result).not.toHaveProperty("missingCostCount");
  });

  it("uses canonical statuses, timestamps, and exact UTC boundaries", async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    await service.getOverview("tenant-1", query());

    const completedCall = prisma.trip.count.mock.calls.find(
      ([args]) => args.where.closedAt,
    )?.[0];
    expect(completedCall.where).toMatchObject({
      tenantId: "tenant-1",
      jobId: { not: null },
      status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
      closedAt: {
        gte: new Date("2026-08-01T00:00:00.000Z"),
        lt: new Date("2026-08-02T00:00:00.000Z"),
      },
    });

    const activeCall = prisma.trip.count.mock.calls.find(
      ([args]) => args.where.status?.in?.includes(TripStatus.PUBLISHED),
    )?.[0];
    expect(activeCall.where.status.in).toEqual([
      TripStatus.PUBLISHED,
      TripStatus.ONGOING,
    ]);
    expect(activeCall.where.closedAt).toBeUndefined();
    expect(activeCall.where.updatedAt).toBeUndefined();

    const cancelledCall = prisma.trip.count.mock.calls.find(
      ([args]) => args.where.status === TripStatus.CANCELLED,
    )?.[0];
    expect(cancelledCall.where.updatedAt).toEqual({
      gte: new Date("2026-08-01T00:00:00.000Z"),
      lt: new Date("2026-08-02T00:00:00.000Z"),
    });
  });

  it("applies every approved filter without weakening tenant scope", async () => {
    const prisma = createPrismaMock();
    const service = createService(prisma);
    await service.getOverview(
      "tenant-1",
      query({
        customerId: "customer-1",
        jobId: "job-1",
        tripId: "trip-1",
        driverId: "driver-1",
        vehicleId: "vehicle-1",
      }),
    );

    const completedWhere = prisma.trip.count.mock.calls.find(
      ([args]) => args.where.closedAt,
    )?.[0].where;
    expect(completedWhere).toMatchObject({
      tenantId: "tenant-1",
      jobId: "job-1",
      id: "trip-1",
      assignedDriverUserId: "driver-1",
      OR: [
        { vehicleId: "vehicle-1" },
        { fleetVehicleId: "vehicle-1" },
      ],
      job: {
        is: {
          tenantId: "tenant-1",
          customerCompanyId: "customer-1",
        },
      },
    });

    const candidateWhere = prisma.job.findMany.mock.calls[0][0].where;
    expect(candidateWhere).toMatchObject({
      tenantId: "tenant-1",
      id: "job-1",
      customerCompanyId: "customer-1",
      AND: expect.arrayContaining([
        {
          trips: {
            some: {
              tenantId: "tenant-1",
              id: "trip-1",
              assignedDriverUserId: "driver-1",
              OR: [
                { vehicleId: "vehicle-1" },
                { fleetVehicleId: "vehicle-1" },
              ],
            },
          },
        },
        {
          trips: {
            some: {
              tenantId: "tenant-1",
              status: { in: [TripStatus.COMPLETED, TripStatus.DONE] },
              closedAt: {
                gte: new Date("2026-08-01T00:00:00.000Z"),
                lt: new Date("2026-08-02T00:00:00.000Z"),
              },
            },
          },
        },
      ]),
    });
    expect(candidateWhere).not.toHaveProperty("routeId");
    expect(candidateWhere).not.toHaveProperty("trailerId");
  });

  it.each([
    ["customerId", "other-customer"],
    ["jobId", "other-job"],
    ["tripId", "other-trip"],
    ["driverId", "other-driver"],
    ["vehicleId", "other-vehicle"],
  ] as const)(
    "keeps a cross-tenant %s filter inside tenant-scoped queries",
    async (field, value) => {
      const prisma = createPrismaMock();
      const service = createService(prisma);
      const result = await service.getOverview(
        "tenant-1",
        query({ [field]: value }),
      );

      expect(result.completedTrips).toBe(0);
      expect(result.operationallyCompletedJobs).toBe(0);
      expect(result.activePendingTrips).toBe(0);
      expect(result.cancelledTrips).toBe(0);
      expect(prisma.tenant.findUnique).toHaveBeenCalledWith({
        where: { id: "tenant-1" },
        select: { timezone: true },
      });
      for (const [args] of prisma.trip.count.mock.calls) {
        expect(args.where.tenantId).toBe("tenant-1");
      }
      for (const [args] of prisma.job.findMany.mock.calls) {
        expect(args.where.tenantId).toBe("tenant-1");
      }
    },
  );

  it.each([
    [
      "one completed trip",
      [
        completedTrip("t1", "j1", "2026-08-01T12:00:00.000Z"),
      ],
      1,
    ],
    [
      "mixed COMPLETED and DONE",
      [
        completedTrip("t1", "j1", "2026-08-01T10:00:00.000Z"),
        completedTrip("t2", "j1", "2026-08-01T12:00:00.000Z", TripStatus.DONE),
      ],
      1,
    ],
    [
      "active trip blocks completion",
      [
        completedTrip("t1", "j1", "2026-08-01T12:00:00.000Z"),
        {
          id: "t2",
          jobId: "j1",
          status: TripStatus.ONGOING,
          closedAt: null,
        },
      ],
      0,
    ],
    [
      "cancelled trip is ignored beside completed work",
      [
        completedTrip("t1", "j1", "2026-08-01T12:00:00.000Z"),
        {
          id: "t2",
          jobId: "j1",
          status: TripStatus.CANCELLED,
          closedAt: null,
        },
      ],
      1,
    ],
    [
      "cancelled-only job is rejected",
      [
        {
          id: "t1",
          jobId: "j1",
          status: TripStatus.CANCELLED,
          closedAt: null,
        },
      ],
      0,
    ],
    [
      "latest close at the exclusive end is rejected",
      [
        completedTrip("t1", "j1", "2026-08-01T12:00:00.000Z"),
        completedTrip("t2", "j1", "2026-08-02T00:00:00.000Z", TripStatus.DONE),
      ],
      0,
    ],
  ])("evaluates operational completion: %s", async (_, rows, expected) => {
    const prisma = createPrismaMock({
      candidateJobs: [{ id: "j1" }],
      candidateTrips: rows as TripRow[],
    });
    const service = createService(prisma);
    const result = await service.getOverview("tenant-1", query());
    expect(result.operationallyCompletedJobs).toBe(expected);
  });

  it("counts each operational job once and accepts the inclusive start", async () => {
    const prisma = createPrismaMock({
      candidateJobs: [{ id: "j1" }, { id: "j2" }],
      candidateTrips: [
        completedTrip("t1", "j1", "2026-08-01T00:00:00.000Z"),
        completedTrip("t2", "j1", "2026-08-01T12:00:00.000Z", TripStatus.DONE),
        completedTrip("t3", "j2", "2026-08-01T08:00:00.000Z", TripStatus.DONE),
      ],
    });
    const service = createService(prisma);
    const result = await service.getOverview("tenant-1", query());

    expect(result.operationallyCompletedJobs).toBe(2);
    expect(prisma.job.findMany).toHaveBeenCalled();
    expect(prisma.trip.findMany.mock.calls[0][0].where).toEqual({
      tenantId: "tenant-1",
      jobId: { in: ["j1", "j2"] },
    });
  });

  describe("bounded job and trip batching", () => {
    it("terminates when the first job batch is empty", async () => {
      const prisma = createPrismaMock({ candidateJobs: [], candidateTrips: [] });
      const service = createService(prisma);
      const result = await service.getOverview("tenant-1", query());

      expect(result.operationallyCompletedJobs).toBe(0);
      expect(prisma.job.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.trip.findMany).not.toHaveBeenCalled();
      expect(prisma.job.findMany.mock.calls[0][0].take).toBe(
        OVERVIEW_JOB_BATCH_SIZE,
      );
    });

    it("terminates after a partial first job batch", async () => {
      const prisma = createPrismaMock({
        candidateJobs: [{ id: "j1" }],
        candidateTrips: [
          completedTrip("t1", "j1", "2026-08-01T12:00:00.000Z"),
        ],
      });
      const service = createService(prisma);
      const result = await service.getOverview("tenant-1", query());

      expect(result.operationallyCompletedJobs).toBe(1);
      expect(prisma.job.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.trip.findMany).toHaveBeenCalledTimes(1);
    });

    it("continues after exactly one full job batch and counts the 201st job once", async () => {
      const candidateJobs = Array.from({ length: 201 }, (_, index) => ({
        id: `job-${String(index + 1).padStart(3, "0")}`,
      }));
      const candidateTrips = candidateJobs.map((job, index) =>
        completedTrip(
          `trip-${String(index + 1).padStart(3, "0")}`,
          job.id,
          "2026-08-01T12:00:00.000Z",
        ),
      );
      const prisma = createPrismaMock({ candidateJobs, candidateTrips });
      const service = createService(prisma);
      const result = await service.getOverview("tenant-1", query());

      expect(result.operationallyCompletedJobs).toBe(201);
      expect(prisma.job.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.job.findMany.mock.calls[0][0].take).toBe(
        OVERVIEW_JOB_BATCH_SIZE,
      );
      expect(prisma.job.findMany.mock.calls[1][0]).toMatchObject({
        take: OVERVIEW_JOB_BATCH_SIZE,
        cursor: { id: "job-200" },
        skip: 1,
        orderBy: { id: "asc" },
      });
      expect(prisma.job.findMany.mock.calls[0][0].select).toEqual({ id: true });
      for (const [args] of prisma.job.findMany.mock.calls) {
        expect(args.where.tenantId).toBe("tenant-1");
      }
    });

    it("cursor-batches trips inside a job batch without duplicating contributions", async () => {
      const tripRows = Array.from(
        { length: OVERVIEW_TRIP_BATCH_SIZE + 1 },
        (_, index) => {
          if (index === 0) {
            return completedTrip(
              `trip-${String(index + 1).padStart(3, "0")}`,
              "j1",
              "2026-08-01T12:00:00.000Z",
            );
          }
          return {
            id: `trip-${String(index + 1).padStart(3, "0")}`,
            jobId: "j1",
            status: TripStatus.CANCELLED,
            closedAt: null,
          } satisfies TripRow;
        },
      );
      const prisma = createPrismaMock({
        candidateJobs: [{ id: "j1" }],
        candidateTrips: tripRows,
      });
      const service = createService(prisma);
      const result = await service.getOverview("tenant-1", query());

      expect(result.operationallyCompletedJobs).toBe(1);
      expect(prisma.trip.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.trip.findMany.mock.calls[0][0].take).toBe(
        OVERVIEW_TRIP_BATCH_SIZE,
      );
      expect(prisma.trip.findMany.mock.calls[1][0]).toMatchObject({
        take: OVERVIEW_TRIP_BATCH_SIZE,
        cursor: { id: `trip-${String(OVERVIEW_TRIP_BATCH_SIZE).padStart(3, "0")}` },
        skip: 1,
        orderBy: { id: "asc" },
        where: {
          tenantId: "tenant-1",
          jobId: { in: ["j1"] },
        },
        select: {
          id: true,
          jobId: true,
          status: true,
          closedAt: true,
        },
      });
    });

    it("keeps exact totals when identical closedAt values span job batches", async () => {
      const stamp = "2026-08-01T12:00:00.000Z";
      const candidateJobs = Array.from({ length: 201 }, (_, index) => ({
        id: `job-${String(index + 1).padStart(3, "0")}`,
      }));
      const candidateTrips = candidateJobs.map((job, index) =>
        completedTrip(
          `trip-${String(index + 1).padStart(3, "0")}`,
          job.id,
          stamp,
        ),
      );
      const prisma = createPrismaMock({ candidateJobs, candidateTrips });
      const service = createService(prisma);
      const result = await service.getOverview("tenant-1", query());
      expect(result.operationallyCompletedJobs).toBe(201);
    });

    it("ignores foreign-tenant trip rows that share a colliding job id", async () => {
      const prisma = createPrismaMock({
        candidateJobs: [{ id: "shared-job" }],
        candidateTrips: [
          completedTrip("local-trip", "shared-job", "2026-08-01T12:00:00.000Z"),
          {
            id: "foreign-trip",
            jobId: "foreign-only",
            status: TripStatus.COMPLETED,
            closedAt: new Date("2026-08-01T12:00:00.000Z"),
          },
        ],
      });
      const service = createService(prisma);
      const result = await service.getOverview("tenant-1", query());

      expect(result.operationallyCompletedJobs).toBe(1);
      for (const [args] of prisma.trip.findMany.mock.calls) {
        expect(args.where.tenantId).toBe("tenant-1");
        expect(args.where.jobId).toEqual({ in: ["shared-job"] });
      }
    });

    it("does not retain a tenant-wide candidate job or trip array across batches", async () => {
      const candidateJobs = Array.from({ length: 250 }, (_, index) => ({
        id: `job-${String(index + 1).padStart(3, "0")}`,
      }));
      const candidateTrips = candidateJobs.map((job, index) =>
        completedTrip(
          `trip-${String(index + 1).padStart(3, "0")}`,
          job.id,
          "2026-08-01T12:00:00.000Z",
        ),
      );
      const prisma = createPrismaMock({ candidateJobs, candidateTrips });
      const service = createService(prisma);
      await service.getOverview("tenant-1", query());

      for (const [args] of prisma.job.findMany.mock.calls) {
        expect(args.take).toBeLessThanOrEqual(OVERVIEW_JOB_BATCH_SIZE);
      }
      for (const [args] of prisma.trip.findMany.mock.calls) {
        expect(args.take).toBeLessThanOrEqual(OVERVIEW_TRIP_BATCH_SIZE);
        expect(args.where.jobId.in.length).toBeLessThanOrEqual(
          OVERVIEW_JOB_BATCH_SIZE,
        );
      }
      expect(prisma.job.findMany).toHaveBeenCalledTimes(2);
    });
  });
});
