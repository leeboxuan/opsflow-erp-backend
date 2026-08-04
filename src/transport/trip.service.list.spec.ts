import { MembershipStatus, TripPendingState, TripStatus } from "@prisma/client";
import { TripService } from "./trip.service";

describe("TripService.listTrips", () => {
  it("batches membership and location lookups once for a page of N trips", async () => {
    const now = new Date("2026-05-05T08:00:00.000Z");
    const trips = Array.from({ length: 5 }, (_, index) => {
      const driverUserId = `driver-${(index % 3) + 1}`;
      return {
        id: `trip-${index + 1}`,
        tenantId: "tenant-1",
        status: TripStatus.PUBLISHED,
        pendingState: TripPendingState.NONE,
        plannedStartAt: now,
        plannedEndAt: null,
        assignedDriverUserId: driverUserId,
        vehicleId: null,
        createdAt: now,
        updatedAt: now,
        vehicles: null,
        stops: [],
      };
    });

    const membershipFindMany = jest.fn().mockResolvedValue([
      {
        userId: "driver-1",
        user: { id: "driver-1", email: "d1@example.com", name: "Driver 1", phone: "111" },
      },
      {
        userId: "driver-2",
        user: { id: "driver-2", email: "d2@example.com", name: "Driver 2", phone: "222" },
      },
      {
        userId: "driver-3",
        user: { id: "driver-3", email: "d3@example.com", name: "Driver 3", phone: null },
      },
    ]);
    const locationFindMany = jest.fn().mockResolvedValue([
      {
        driverUserId: "driver-1",
        lat: 1.1,
        lng: 103.1,
        accuracy: 5,
        heading: 10,
        speed: 20,
        capturedAt: now,
        updatedAt: now,
      },
      {
        driverUserId: "driver-2",
        lat: 1.2,
        lng: 103.2,
        accuracy: null,
        heading: null,
        speed: null,
        capturedAt: now,
        updatedAt: now,
      },
    ]);

    const prisma: any = {
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      trip: {
        count: jest.fn().mockResolvedValue(trips.length),
        findMany: jest.fn().mockResolvedValue(trips),
      },
      tenantMembership: {
        findMany: membershipFindMany,
        findFirst: jest.fn(),
      },
      driverLocationLatest: {
        findMany: locationFindMany,
        findUnique: jest.fn(),
      },
    };
    const eventLogService = { logEvent: jest.fn() } as any;
    const svc = new TripService(prisma, eventLogService);

    const res = await svc.listTrips("tenant-1", { page: 1, pageSize: 20 });

    expect(membershipFindMany).toHaveBeenCalledTimes(1);
    expect(locationFindMany).toHaveBeenCalledTimes(1);
    expect(prisma.tenantMembership.findFirst).not.toHaveBeenCalled();
    expect(prisma.driverLocationLatest.findUnique).not.toHaveBeenCalled();

    expect(membershipFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        userId: { in: expect.arrayContaining(["driver-1", "driver-2", "driver-3"]) },
        status: MembershipStatus.Active,
      },
      include: { user: true },
    });
    expect(locationFindMany).toHaveBeenCalledWith({
      where: {
        tenantId: "tenant-1",
        driverUserId: { in: expect.arrayContaining(["driver-1", "driver-2", "driver-3"]) },
      },
    });

    const membershipIds = membershipFindMany.mock.calls[0][0].where.userId.in;
    const locationIds = locationFindMany.mock.calls[0][0].where.driverUserId.in;
    expect(membershipIds).toHaveLength(3);
    expect(locationIds).toHaveLength(3);

    expect(res.data).toHaveLength(5);
    expect(res.meta).toEqual({ page: 1, pageSize: 20, total: 5 });
    expect(res.data[0].assignedDriver).toEqual({
      id: "driver-1",
      email: "d1@example.com",
      name: "Driver 1",
      phone: "111",
    });
    expect(res.data[0].driverLocation).toEqual({
      lat: 1.1,
      lng: 103.1,
      accuracy: 5,
      heading: 10,
      speed: 20,
      capturedAt: now,
      updatedAt: now,
    });
    expect(res.data[2].assignedDriver?.id).toBe("driver-3");
    expect(res.data[2].driverLocation).toBeNull();
  });

  it("never queries membership or location without tenantId (cross-tenant isolation)", async () => {
    const now = new Date("2026-05-05T08:00:00.000Z");
    const membershipFindMany = jest.fn().mockResolvedValue([]);
    const locationFindMany = jest.fn().mockResolvedValue([
      // Would be a leak if returned without tenant filter matching.
      {
        driverUserId: "driver-1",
        lat: 9.9,
        lng: 9.9,
        accuracy: null,
        heading: null,
        speed: null,
        capturedAt: now,
        updatedAt: now,
      },
    ]);
    const prisma: any = {
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      trip: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip-1",
            tenantId: "tenant-secure",
            status: TripStatus.PUBLISHED,
            pendingState: TripPendingState.NONE,
            plannedStartAt: now,
            plannedEndAt: null,
            assignedDriverUserId: "driver-1",
            vehicleId: null,
            createdAt: now,
            updatedAt: now,
            vehicles: null,
            stops: [],
          },
        ]),
      },
      tenantMembership: { findMany: membershipFindMany, findFirst: jest.fn() },
      driverLocationLatest: { findMany: locationFindMany, findUnique: jest.fn() },
    };
    const svc = new TripService(prisma, { logEvent: jest.fn() } as any);
    await svc.listTrips("tenant-secure", { page: 1, pageSize: 20 });

    expect(membershipFindMany.mock.calls[0][0].where.tenantId).toBe("tenant-secure");
    expect(locationFindMany.mock.calls[0][0].where.tenantId).toBe("tenant-secure");
    expect(prisma.trip.findMany.mock.calls[0][0].where.tenantId).toBe("tenant-secure");
  });

  it("skips membership/location batch queries when no drivers are assigned", async () => {
    const now = new Date("2026-05-05T08:00:00.000Z");
    const prisma: any = {
      $transaction: jest.fn(async (ops: Promise<unknown>[]) => Promise.all(ops)),
      trip: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "trip-1",
            tenantId: "tenant-1",
            status: TripStatus.DRAFT,
            pendingState: TripPendingState.NONE,
            plannedStartAt: null,
            plannedEndAt: null,
            assignedDriverUserId: null,
            vehicleId: null,
            createdAt: now,
            updatedAt: now,
            vehicles: null,
            stops: [],
          },
        ]),
      },
      tenantMembership: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      driverLocationLatest: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
    };
    const svc = new TripService(prisma, { logEvent: jest.fn() } as any);
    const res = await svc.listTrips("tenant-1", { page: 1, pageSize: 10 });

    expect(prisma.tenantMembership.findMany).not.toHaveBeenCalled();
    expect(prisma.driverLocationLatest.findMany).not.toHaveBeenCalled();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].assignedDriver).toBeNull();
    expect(res.data[0].driverLocation).toBeNull();
  });
});
