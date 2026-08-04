import { NotFoundException } from "@nestjs/common";
import { MembershipStatus, Role, StopStatus, TripStatus } from "@prisma/client";
import { AdminDriversService } from "./admin-drivers.service";
import { Reflector } from "@nestjs/core";
import { RoleGuard } from "../../shared/auth/guards/role.guard";
import { AdminDriversController } from "./admin-drivers.controller";

describe("AdminDriversService driver detail", () => {
  function makeService(overrides?: {
    prisma?: Partial<any>;
    tripEarnings?: Partial<any>;
  }) {
    const prisma: any = {
      $transaction: jest.fn(async (arg: any) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg(prisma);
      }),
      tenantMembership: {
        findUnique: jest.fn().mockResolvedValue({
          id: "m1",
          role: Role.DRIVER,
          status: MembershipStatus.Active,
          user: {
            id: "u-driver",
            email: "driver@demo.com",
            name: "Driver One",
            displayName: "Driver One",
            phone: "+6500000",
            avatarKey: null,
            avatarUpdatedAt: null,
            createdAt: new Date("2026-01-01T00:00:00.000Z"),
            updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          },
        }),
      },
      drivers: {
        findFirst: jest.fn().mockResolvedValue({
          name: "Driver One",
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
        }),
      },
      vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
      fleetVehicle: { findFirst: jest.fn().mockResolvedValue(null) },
      trip: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      stop: { groupBy: jest.fn().mockResolvedValue([]) },
      ...overrides?.prisma,
    };

    const usersService: any = {
      getUserAvatarSignedUrl: jest.fn().mockResolvedValue(null),
    };
    const tripEarnings: any = {
      getEarningsTotals: jest.fn().mockResolvedValue({
        month: "2026-05",
        monthCents: 12500,
        monthCompletedTripCount: 2,
        lifetimeCents: 50000,
        lifetimeCompletedTripCount: 10,
        currency: "SGD",
        timeZone: "Asia/Singapore",
      }),
      listEarningsTransactions: jest.fn().mockResolvedValue({
        data: [],
        meta: { page: 1, pageSize: 20, total: 0 },
        month: "2026-05",
        currency: "SGD",
      }),
      ...overrides?.tripEarnings,
    };

    return {
      service: new AdminDriversService(
        prisma,
        { getClient: jest.fn() } as any,
        usersService,
        tripEarnings,
      ),
      prisma,
      tripEarnings,
      usersService,
    };
  }

  it("returns same-tenant driver summary with earnings KPIs", async () => {
    const { service, tripEarnings } = makeService({
      prisma: {
        trip: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "trip-on",
              jobId: "job-1",
              title: "Ongoing",
              displayTitle: null,
              status: TripStatus.ONGOING,
              plannedStartAt: new Date("2026-05-01T00:00:00.000Z"),
              startedAt: new Date("2026-05-01T01:00:00.000Z"),
              createdAt: new Date("2026-05-01T00:00:00.000Z"),
              originLabel: "Port A",
              originAddressLine1: null,
              originAddressLine2: null,
              originPostalCode: null,
              destinationLabel: "Site B",
              destinationAddressLine1: null,
              destinationAddressLine2: null,
              destinationPostalCode: null,
              job: { internalRef: "JOB-1" },
            },
          ]),
        },
      },
    });

    const res = await service.getDriverSummary("t1", "u-driver", "2026-05");
    expect(res.driver.id).toBe("u-driver");
    expect(res.monthEarningsCents).toBe(12500);
    expect(res.lifetimeEarningsCents).toBe(50000);
    expect(res.currency).toBe("SGD");
    expect(res.currentOrNextTrip?.tripId).toBe("trip-on");
    expect(res.currentOrNextTrip?.kind).toBe("current");
    expect(tripEarnings.getEarningsTotals).toHaveBeenCalledWith(
      "t1",
      "u-driver",
      "2026-05",
    );
  });

  it("treats cross-tenant / missing driver as not found", async () => {
    const { service } = makeService({
      prisma: {
        tenantMembership: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      },
    });
    await expect(
      service.getDriverSummary("t1", "other-tenant-driver"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("paginates trip history with stable ordering and batched stop counts", async () => {
    const trips = [
      {
        id: "trip-b",
        jobId: "job-b",
        title: "B",
        displayTitle: null,
        status: TripStatus.COMPLETED,
        closedAt: new Date("2026-05-20T00:00:00.000Z"),
        startedAt: null,
        plannedStartAt: null,
        updatedAt: new Date("2026-05-20T00:00:00.000Z"),
        driverEarningCents: 1000,
        earningLabelSnapshot: null,
        originLabel: "A",
        originAddressLine1: null,
        originAddressLine2: null,
        originPostalCode: null,
        destinationLabel: "B",
        destinationAddressLine1: null,
        destinationAddressLine2: null,
        destinationPostalCode: null,
        payoutLines: [],
        job: { internalRef: "JOB-B" },
      },
      {
        id: "trip-a",
        jobId: "job-a",
        title: "A",
        displayTitle: null,
        status: TripStatus.DONE,
        closedAt: new Date("2026-05-10T00:00:00.000Z"),
        startedAt: null,
        plannedStartAt: null,
        updatedAt: new Date("2026-05-10T00:00:00.000Z"),
        driverEarningCents: null,
        earningLabelSnapshot: null,
        originLabel: null,
        originAddressLine1: "Origin Rd",
        originAddressLine2: null,
        originPostalCode: null,
        destinationLabel: null,
        destinationAddressLine1: "Dest Rd",
        destinationAddressLine2: null,
        destinationPostalCode: null,
        payoutLines: [{ totalCents: 500 }],
        job: { internalRef: "JOB-A" },
      },
    ];

    const { service, prisma } = makeService({
      prisma: {
        trip: {
          count: jest.fn().mockResolvedValue(2),
          findMany: jest.fn().mockResolvedValue(trips),
        },
        stop: {
          groupBy: jest.fn().mockResolvedValue([
            { tripId: "trip-b", status: StopStatus.Completed, _count: { _all: 2 } },
            { tripId: "trip-b", status: StopStatus.Pending, _count: { _all: 1 } },
            { tripId: "trip-a", status: StopStatus.Completed, _count: { _all: 1 } },
          ]),
        },
      },
    });

    const res = await service.listDriverTrips("t1", "u-driver", {
      page: 1,
      pageSize: 20,
    });
    expect(res.meta.total).toBe(2);
    expect(res.data[0].tripId).toBe("trip-b");
    expect(res.data[0].stopCount).toBe(3);
    expect(res.data[0].completedStopCount).toBe(2);
    expect(res.data[1].driverEarningCents).toBe(500);
    expect(prisma.stop.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.trip.findMany.mock.calls[0][0].orderBy).toEqual([
      { closedAt: "desc" },
      { updatedAt: "desc" },
      { id: "desc" },
    ]);
    expect(prisma.trip.findMany.mock.calls[0][0].where.status.in).toEqual([
      TripStatus.COMPLETED,
      TripStatus.DONE,
    ]);
  });

  it("delegates earnings endpoints to canonical trip earnings service", async () => {
    const { service, tripEarnings } = makeService();
    await service.getDriverEarnings("t1", "u-driver", "2026-05");
    expect(tripEarnings.getEarningsTotals).toHaveBeenCalledWith(
      "t1",
      "u-driver",
      "2026-05",
    );
    await service.listDriverEarningsTransactions("t1", "u-driver", {
      month: "2026-05",
      page: 1,
    });
    expect(tripEarnings.listEarningsTransactions).toHaveBeenCalled();
  });

  it("selects next PUBLISHED trip when no ONGOING trip exists", async () => {
    const { service } = makeService({
      prisma: {
        trip: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "trip-next",
              jobId: "job-2",
              title: "Next",
              displayTitle: null,
              status: TripStatus.PUBLISHED,
              plannedStartAt: new Date("2026-06-01T00:00:00.000Z"),
              startedAt: null,
              createdAt: new Date("2026-05-01T00:00:00.000Z"),
              originLabel: null,
              originAddressLine1: null,
              originAddressLine2: null,
              originPostalCode: null,
              destinationLabel: null,
              destinationAddressLine1: null,
              destinationAddressLine2: null,
              destinationPostalCode: null,
              job: { internalRef: "JOB-2" },
            },
          ]),
        },
      },
    });
    const res = await service.getDriverSummary("t1", "u-driver");
    expect(res.currentOrNextTrip?.kind).toBe("next");
    expect(res.currentOrNextTrip?.tripId).toBe("trip-next");
  });
});

describe("AdminDriversController RBAC metadata", () => {
  it("requires ADMIN or TRANSPORT_STAFF on controller; excludes DRIVER and FINANCE", () => {
    const reflector = new Reflector();
    const declared =
      reflector.getAllAndOverride<Role[]>("roles", [
        AdminDriversController.prototype.summary,
        AdminDriversController,
      ]) ?? [];
    expect(declared).toEqual(
      expect.arrayContaining([Role.ADMIN, Role.TRANSPORT_STAFF]),
    );
    expect(declared).not.toContain(Role.DRIVER);
    expect(declared).not.toContain(Role.FINANCE);

    const guard = new RoleGuard(reflector);
    for (const role of [Role.ADMIN, Role.TRANSPORT_STAFF, Role.OPS]) {
      const allowed = guard.canActivate({
        switchToHttp: () => ({
          getRequest: () => ({ tenant: { tenantId: "t1", role } }),
        }),
        getHandler: () => AdminDriversController.prototype.summary,
        getClass: () => AdminDriversController,
      } as any);
      expect(allowed).toBe(true);
    }
    for (const role of [Role.DRIVER, Role.FINANCE, Role.CUSTOMER]) {
      expect(() =>
        guard.canActivate({
          switchToHttp: () => ({
            getRequest: () => ({ tenant: { tenantId: "t1", role } }),
          }),
          getHandler: () => AdminDriversController.prototype.summary,
          getClass: () => AdminDriversController,
        } as any),
      ).toThrow();
    }
  });
});
