import { Role } from "@prisma/client";
import { AdminDriversService } from "./admin-drivers.service";

describe("AdminDriversService", () => {
  function makeService(overrides?: Partial<any>) {
    const prisma: any = {
      $transaction: jest.fn(async (arg: any) => {
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg(prisma);
      }),
      tenantMembership: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "m1",
            userId: "u-driver",
            role: Role.DRIVER,
            status: "Active",
            createdAt: new Date("2026-05-08T00:00:00.000Z"),
            user: {
              id: "u-driver",
              email: "driver@demo.com",
              name: "Old Driver",
              displayName: "Driver Display",
              avatarKey: "t1/users/u-driver/avatar.jpg",
              avatarUpdatedAt: new Date("2026-05-08T01:00:00.000Z"),
              phone: "+6500000",
              createdAt: new Date("2026-05-08T00:00:00.000Z"),
              updatedAt: new Date("2026-05-08T00:00:00.000Z"),
            },
          },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          id: "m1",
          role: Role.DRIVER,
          status: "Active",
          user: {
            id: "u-driver",
            email: "driver@demo.com",
            name: "Old Driver",
            phone: "+6500000",
            createdAt: new Date("2026-05-08T00:00:00.000Z"),
            updatedAt: new Date("2026-05-08T00:00:00.000Z"),
          },
        }),
      },
      user: {
        update: jest.fn().mockResolvedValue({
          id: "u-driver",
          email: "driver@demo.com",
          name: "New Driver",
          phone: "+6500000",
          createdAt: new Date("2026-05-08T00:00:00.000Z"),
          updatedAt: new Date("2026-05-08T00:00:00.000Z"),
        }),
      },
      drivers: {
        findMany: jest.fn().mockResolvedValue([
          {
            userId: "u-driver",
            name: "Driver Profile Name",
            assignedVehicleId: null,
            assignedFleetVehicleId: null,
          },
        ]),
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue({
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
        }),
      },
      vehicle: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      fleetVehicle: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      ...overrides,
    };
    const usersService: any = {
      getUserAvatarSignedUrl: jest
        .fn()
        .mockImplementation(async (key: string | null) =>
          key ? "https://signed/user-avatar" : null,
        ),
      updateUserDisplayNameAndPropagate: jest.fn().mockResolvedValue({
        id: "u-driver",
        email: "driver@demo.com",
        name: "New Driver",
        displayName: "New Driver",
        avatarKey: null,
        avatarUpdatedAt: null,
        phone: "+6500000",
        createdAt: new Date("2026-05-08T00:00:00.000Z"),
        updatedAt: new Date("2026-05-08T00:00:00.000Z"),
      }),
    };
    const supabaseService: any = { getClient: jest.fn() };
    const tripEarnings: any = {
      getEarningsTotals: jest.fn(),
      listEarningsTransactions: jest.fn(),
      getWalletSummaryByMonth: jest.fn(),
    };
    return {
      service: new AdminDriversService(
        prisma,
        supabaseService,
        usersService,
        tripEarnings,
      ),
      prisma,
      usersService,
      tripEarnings,
    };
  }

  it("admin changing driver name triggers propagation", async () => {
    const { service, usersService } = makeService();
    await service.updateDriver(
      "t1",
      "u-driver",
      { name: "New Driver" } as any,
      "u-admin",
    );
    expect(usersService.updateUserDisplayNameAndPropagate).toHaveBeenCalledWith({
      tenantId: "t1",
      userId: "u-driver",
      newName: "New Driver",
      actorUserId: "u-admin",
    });
  });

  it("driver list includes avatarUrl when user has avatarKey", async () => {
    const { service, usersService } = makeService();
    const result = await service.listDrivers("t1", {} as any);
    expect(result.data[0].avatarUrl).toBe("https://signed/user-avatar");
    expect(usersService.getUserAvatarSignedUrl).toHaveBeenCalledWith(
      "t1/users/u-driver/avatar.jpg",
    );
  });

  it("driver list returns avatarUrl null when no avatarKey", async () => {
    const { service } = makeService({
      tenantMembership: {
        count: jest.fn().mockResolvedValue(1),
        findMany: jest.fn().mockResolvedValue([
          {
            id: "m1",
            userId: "u-driver",
            role: Role.DRIVER,
            status: "Active",
            user: {
              id: "u-driver",
              email: "driver@demo.com",
              name: "Old Driver",
              displayName: null,
              avatarKey: null,
              avatarUpdatedAt: null,
              phone: "+6500000",
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        ]),
        findUnique: jest.fn().mockResolvedValue({
          id: "m1",
          role: Role.DRIVER,
          status: "Active",
          user: {
            id: "u-driver",
            email: "driver@demo.com",
            name: "Old Driver",
            phone: "+6500000",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      },
    });
    const result = await service.listDrivers("t1", {} as any);
    expect(result.data[0].avatarUrl).toBeNull();
  });

  it("tenant isolation is enforced in list query", async () => {
    const count = jest.fn().mockResolvedValue(0);
    const findMany = jest.fn().mockResolvedValue([]);
    const { service } = makeService({
      tenantMembership: {
        count,
        findMany,
        findUnique: jest.fn().mockResolvedValue({
          id: "m1",
          role: Role.DRIVER,
          status: "Active",
          user: {
            id: "u-driver",
            email: "driver@demo.com",
            name: "Old Driver",
            phone: "+6500000",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        }),
      },
      drivers: {
        findMany: jest.fn().mockResolvedValue([]),
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue({
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
        }),
      },
      vehicle: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
      fleetVehicle: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn() },
    });
    await service.listDrivers("tenant-a", {} as any);
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-a" }),
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: "tenant-a" }),
      }),
    );
  });
});
