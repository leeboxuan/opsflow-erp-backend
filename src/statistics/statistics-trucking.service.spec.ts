import { JobType, TripStatus } from "@prisma/client";
import { StatisticsTruckingService } from "./statistics-trucking.service";

function movement(input: {
  id: string;
  jobItemId: string;
  itemCode: string;
  description?: string | null;
  snapshot?: string | null;
  tripId: string;
  jobId: string;
  jobNo: string;
  jobType?: JobType;
  customerId?: string;
  customerName?: string;
  driverUserId?: string | null;
  origin?: string | null;
  destination?: string | null;
  vehicleId?: string | null;
  plate?: string | null;
  status?: TripStatus;
  startedAt?: string | null;
  closedAt: string;
  jobSequence?: number;
}) {
  return {
    id: input.id,
    jobItemId: input.jobItemId,
    containerNumberSnapshot: input.snapshot ?? null,
    jobItem: {
      itemCode: input.itemCode,
      description: input.description ?? "20FT",
    },
    trip: {
      id: input.tripId,
      jobId: input.jobId,
      jobSequence: input.jobSequence ?? 1,
      tripSequence: input.jobSequence ?? 1,
      status: input.status ?? TripStatus.COMPLETED,
      startedAt: input.startedAt ? new Date(input.startedAt) : new Date("2026-08-01T01:00:00.000Z"),
      closedAt: new Date(input.closedAt),
      originLabel: input.origin === undefined ? "PSA" : input.origin,
      destinationLabel:
        input.destination === undefined ? "Customer" : input.destination,
      assignedDriverUserId: input.driverUserId ?? "driver-rahmat",
      vehicleId: input.vehicleId ?? "vehicle-1",
      fleetVehicleId: null,
      acceptedVehicleNo: null,
      trailerNumber: null,
      acceptedTrailerNo: null,
      completionRuleJson: null,
      job: {
        id: input.jobId,
        internalRef: input.jobNo,
        jobType: input.jobType ?? JobType.IMPORT,
        customerCompanyId: input.customerId ?? "cust-1",
        customerCompany: { name: input.customerName ?? "Acme" },
      },
      fleetVehicle: null,
      vehicles: input.plate
        ? { id: input.vehicleId ?? "vehicle-1", plateNo: input.plate, type: "PRIME_MOVER" }
        : { id: "vehicle-1", plateNo: "SBA1234A", type: "PRIME_MOVER" },
    },
  };
}

function createPrismaMock(rows: ReturnType<typeof movement>[]) {
  return {
    tenant: {
      findUnique: jest.fn().mockResolvedValue({ timezone: "Asia/Singapore", name: "Demo" }),
    },
    tripJobItem: {
      findMany: jest.fn().mockImplementation(async (args: any) => {
        const take: number = args.take ?? rows.length;
        let start = 0;
        if (args.cursor?.id) {
          const index = rows.findIndex((row) => row.id === args.cursor.id);
          start = index >= 0 ? index + (args.skip ?? 0) : rows.length;
        }
        if (args.skip && !args.cursor) start = args.skip;
        return rows.slice(start, start + take);
      }),
      count: jest.fn().mockResolvedValue(rows.length),
    },
    trip: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tripDocument: { findMany: jest.fn().mockResolvedValue([]) },
    drivers: {
      findMany: jest.fn().mockResolvedValue([
        { userId: "driver-rahmat", name: "Rahmat" },
        { userId: "driver-mazaidi", name: "Mazaidi" },
      ]),
    },
    user: { findMany: jest.fn().mockResolvedValue([]) },
  };
}

describe("StatisticsTruckingService", () => {
  const query = { from: "2026-08-01", to: "2026-08-01" };

  it("counts one container and two movements from TripJobItem, not trip cache", async () => {
    const rows = [
      movement({
        id: "link-1",
        jobItemId: "item-abc",
        itemCode: "ABC",
        tripId: "trip-1",
        jobId: "job-1",
        jobNo: "JOB-001",
        jobSequence: 1,
        driverUserId: "driver-rahmat",
        origin: "PSA",
        destination: "Customer",
        closedAt: "2026-08-01T02:00:00.000Z",
      }),
      movement({
        id: "link-2",
        jobItemId: "item-abc",
        itemCode: "ABC",
        tripId: "trip-2",
        jobId: "job-1",
        jobNo: "JOB-001",
        jobSequence: 2,
        driverUserId: "driver-mazaidi",
        origin: "Customer",
        destination: "Depot",
        closedAt: "2026-08-01T04:00:00.000Z",
      }),
    ];
    const prisma = createPrismaMock(rows);
    const service = new StatisticsTruckingService(prisma as any);
    const summary = await service.getSummary("tenant-1", query);
    expect(summary.uniqueContainers).toBe(1);
    expect(summary.containerMovements).toBe(2);
    expect(summary.containersHandledByMultipleDrivers).toBe(1);

    const containers = await service.getContainers("tenant-1", { ...query, page: 1, pageSize: 20 });
    expect(containers.data).toHaveLength(1);
    expect(containers.data[0]?.driversTouched).toBe(2);
    expect(containers.data[0]?.driverNames).toContain("Rahmat");
    expect(containers.data[0]?.driverNames).toContain("Mazaidi");
    expect(containers.data[0]?.containerNo).toBe("ABC");
  });

  it("counts driversTouched 1 when the same driver performs both trips", async () => {
    const rows = [
      movement({
        id: "link-1",
        jobItemId: "item-abc",
        itemCode: "ABC",
        tripId: "trip-1",
        jobId: "job-1",
        jobNo: "JOB-001",
        driverUserId: "driver-rahmat",
        closedAt: "2026-08-01T02:00:00.000Z",
      }),
      movement({
        id: "link-2",
        jobItemId: "item-abc",
        itemCode: "ABC",
        tripId: "trip-2",
        jobId: "job-1",
        jobNo: "JOB-001",
        jobSequence: 2,
        driverUserId: "driver-rahmat",
        closedAt: "2026-08-01T04:00:00.000Z",
      }),
    ];
    const service = new StatisticsTruckingService(createPrismaMock(rows) as any);
    const containers = await service.getAllContainers("tenant-1", query);
    expect(containers[0]?.driversTouched).toBe(1);
    expect(containers[0]?.movements).toBe(2);
  });

  it("does not let Trip.containerNumber cache create extra movements", async () => {
    const rows = [
      movement({
        id: "link-1",
        jobItemId: "item-abc",
        itemCode: "ABC",
        snapshot: "ABC",
        tripId: "trip-1",
        jobId: "job-1",
        jobNo: "JOB-001",
        closedAt: "2026-08-01T02:00:00.000Z",
      }),
    ];
    const prisma = createPrismaMock(rows);
    const service = new StatisticsTruckingService(prisma as any);
    const summary = await service.getSummary("tenant-1", query);
    expect(summary.containerMovements).toBe(1);
    expect(prisma.tripJobItem.findMany).toHaveBeenCalled();
  });

  it("excludes cancelled trips from container movements", async () => {
    const rows = [
      movement({
        id: "link-1",
        jobItemId: "item-abc",
        itemCode: "ABC",
        tripId: "trip-1",
        jobId: "job-1",
        jobNo: "JOB-001",
        status: TripStatus.CANCELLED,
        closedAt: "2026-08-01T02:00:00.000Z",
      }),
    ];
    const service = new StatisticsTruckingService(createPrismaMock(rows) as any);
    const summary = await service.getSummary("tenant-1", query);
    expect(summary.uniqueContainers).toBe(0);
    expect(summary.containerMovements).toBe(0);
  });

  it("keeps tenant isolation on movement queries and paginates deterministically", async () => {
    const rows = [
      movement({
        id: "link-1",
        jobItemId: "item-a",
        itemCode: "AAA",
        tripId: "trip-1",
        jobId: "job-1",
        jobNo: "JOB-001",
        closedAt: "2026-08-01T02:00:00.000Z",
      }),
      movement({
        id: "link-2",
        jobItemId: "item-b",
        itemCode: "BBB",
        tripId: "trip-2",
        jobId: "job-2",
        jobNo: "JOB-002",
        closedAt: "2026-08-01T03:00:00.000Z",
      }),
    ];
    const prisma = createPrismaMock(rows);
    const service = new StatisticsTruckingService(prisma as any);
    const page = await service.getMovements("tenant-a", {
      ...query,
      page: 1,
      pageSize: 1,
      sortBy: "movementDate",
      sortDir: "asc",
    });
    expect(page.meta.total).toBe(2);
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.containerNo).toBe("AAA");
    expect(prisma.tripJobItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-a" }),
      }),
    );
  });

  it("groups lanes from origin/destination labels without inventing missing endpoints", async () => {
    const rows = [
      movement({
        id: "link-1",
        jobItemId: "item-abc",
        itemCode: "ABC",
        tripId: "trip-1",
        jobId: "job-1",
        jobNo: "JOB-001",
        origin: "PSA",
        destination: "Customer",
        closedAt: "2026-08-01T02:00:00.000Z",
      }),
      movement({
        id: "link-2",
        jobItemId: "item-abc",
        itemCode: "ABC",
        tripId: "trip-2",
        jobId: "job-1",
        jobNo: "JOB-001",
        origin: null,
        destination: null,
        closedAt: "2026-08-01T03:00:00.000Z",
      }),
    ];
    const service = new StatisticsTruckingService(createPrismaMock(rows) as any);
    const lanes = await service.getAllLanes("tenant-1", query);
    expect(lanes.some((row) => row.lane === "PSA → Customer")).toBe(true);
    expect(lanes.some((row) => row.origin === "Unspecified origin")).toBe(true);
  });

  it("aggregates fleet by vehicle plate across multiple movements", async () => {
    const rows = [
      movement({
        id: "link-1",
        jobItemId: "item-1",
        itemCode: "C1",
        tripId: "trip-1",
        jobId: "job-1",
        jobNo: "JOB-001",
        vehicleId: "vehicle-1",
        plate: "SBA1234A",
        closedAt: "2026-08-01T02:00:00.000Z",
      }),
      movement({
        id: "link-2",
        jobItemId: "item-2",
        itemCode: "C2",
        tripId: "trip-2",
        jobId: "job-2",
        jobNo: "JOB-002",
        vehicleId: "vehicle-1",
        plate: "SBA1234A",
        closedAt: "2026-08-01T05:00:00.000Z",
      }),
    ];
    const prisma = createPrismaMock(rows);
    prisma.trip.findMany.mockImplementation(async (args: any) => {
      if (args.where?.status?.in) {
        return rows.map((row) => ({
          id: row.trip.id,
          closedAt: row.trip.closedAt,
          startedAt: row.trip.startedAt,
          assignedDriverUserId: row.trip.assignedDriverUserId,
          vehicleId: row.trip.vehicleId,
          fleetVehicleId: null,
          acceptedVehicleNo: null,
          fleetVehicle: null,
          vehicles: row.trip.vehicles,
        }));
      }
      return [];
    });
    const service = new StatisticsTruckingService(prisma as any);
    const fleet = await service.getAllFleet("tenant-1", query);
    expect(fleet.vehicles[0]?.plateNo).toBe("SBA1234A");
    expect(fleet.vehicles[0]?.containerMovements).toBe(2);
    expect(fleet.vehicles[0]?.uniqueContainers).toBe(2);
    expect(fleet.vehicles[0]?.activeDays).toBeGreaterThanOrEqual(1);
  });
});
