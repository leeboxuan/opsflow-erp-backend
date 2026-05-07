import { Role } from "@prisma/client";
import { AdminDriversService } from "./admin-drivers.service";

describe("AdminDriversService", () => {
  function makeService(overrides?: Partial<any>) {
    const prisma: any = {
      tenantMembership: {
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
      vehicle: { findFirst: jest.fn().mockResolvedValue(null) },
      fleetVehicle: { findFirst: jest.fn().mockResolvedValue(null) },
      drivers: {
        upsert: jest.fn().mockResolvedValue({}),
        findFirst: jest.fn().mockResolvedValue({
          assignedVehicleId: null,
          assignedFleetVehicleId: null,
        }),
      },
      ...overrides,
    };
    const usersService: any = {
      updateUserDisplayNameAndPropagate: jest.fn().mockResolvedValue({
        id: "u-driver",
        email: "driver@demo.com",
        name: "New Driver",
        phone: "+6500000",
        createdAt: new Date("2026-05-08T00:00:00.000Z"),
        updatedAt: new Date("2026-05-08T00:00:00.000Z"),
      }),
    };
    const supabaseService: any = { getClient: jest.fn() };
    return {
      service: new AdminDriversService(prisma, supabaseService, usersService),
      prisma,
      usersService,
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
});
