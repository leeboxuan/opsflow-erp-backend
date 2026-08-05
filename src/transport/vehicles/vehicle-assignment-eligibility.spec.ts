import { BadRequestException, NotFoundException } from "@nestjs/common";
import { VehicleStatus } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { FleetVehiclesService } from "../fleet/vehicles/fleet-vehicles.service";
import { ListFleetVehiclesQueryDto } from "../fleet/vehicles/dto/list-fleet-vehicles.query.dto";
import { ListVehiclesQueryDto } from "./dto/list-vehicles.query.dto";
import { VehiclesService } from "./vehicles.service";

function createPrismaMock() {
  const prisma: any = {
    vehicle: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    fleetVehicle: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    drivers: { updateMany: jest.fn() },
    user: { findFirst: jest.fn() },
  };
  prisma.$transaction = jest.fn(async (input: any) =>
    typeof input === "function" ? input(prisma) : Promise.all(input),
  );
  return prisma;
}

const activeVehicle = {
  id: "vehicle-1",
  tenantId: "tenant-1",
  plateNo: "SGX 1234A",
  type: "VAN",
  status: VehicleStatus.ACTIVE,
  vehicleDescription: "Toyota Hiace",
  driverId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("eligible-list query contract", () => {
  // The global ValidationPipe runs with forbidNonWhitelisted, so an unknown
  // query property is rejected with 400 before reaching the service.
  const query = {
    page: "1",
    pageSize: "25",
    eligibleForAssignment: "true",
    sortBy: "plateNo",
    sortDir: "asc",
  };

  it("accepts the eligible-for-assignment query on standard vehicles", async () => {
    const dto = plainToInstance(ListVehiclesQueryDto, query);
    await expect(validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
      .resolves.toHaveLength(0);
    expect(dto.eligibleForAssignment).toBe(true);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(25);
  });

  it("accepts the eligible-for-assignment query on fleet vehicles", async () => {
    const dto = plainToInstance(ListFleetVehiclesQueryDto, query);
    await expect(validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
      .resolves.toHaveLength(0);
    expect(dto.eligibleForAssignment).toBe(true);
  });

  it("treats an omitted flag as a normal list request", async () => {
    const dto = plainToInstance(ListVehiclesQueryDto, { page: "1" });
    await expect(validate(dto, { whitelist: true, forbidNonWhitelisted: true }))
      .resolves.toHaveLength(0);
    expect(dto.eligibleForAssignment).toBeUndefined();
  });
});

describe("vehicle assignment eligibility", () => {
  describe("standard vehicles", () => {
    it("assigns an ACTIVE unassigned vehicle atomically", async () => {
      const prisma = createPrismaMock();
      prisma.vehicle.findFirst.mockResolvedValueOnce({
        id: "vehicle-1",
        driverId: null,
        status: VehicleStatus.ACTIVE,
      });
      prisma.user.findFirst.mockResolvedValue({ id: "driver-1" });
      prisma.vehicle.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.vehicle.findUniqueOrThrow.mockResolvedValue({
        ...activeVehicle,
        driverId: "driver-1",
      });

      const service = new VehiclesService(prisma);
      await service.assignDriver("tenant-1", "vehicle-1", "driver-1");

      expect(prisma.vehicle.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: "vehicle-1",
          tenantId: "tenant-1",
          status: VehicleStatus.ACTIVE,
          OR: [{ driverId: null }, { driverId: "driver-1" }],
        },
        data: { driverId: "driver-1" },
      });
      expect(prisma.vehicle.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          tenantId: "tenant-1",
          driverId: "driver-1",
          id: { not: "vehicle-1" },
        },
        data: { driverId: null },
      });
    });

    it.each([VehicleStatus.MAINTENANCE, VehicleStatus.INACTIVE])(
      "rejects a %s vehicle",
      async (status) => {
        const prisma = createPrismaMock();
        prisma.vehicle.findFirst.mockResolvedValue({
          id: "vehicle-1",
          driverId: null,
          status,
        });
        const service = new VehiclesService(prisma);

        await expect(
          service.assignDriver("tenant-1", "vehicle-1", "driver-1"),
        ).rejects.toThrow("Only active vehicles can be assigned to drivers.");
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );

    it("revalidates status inside the transaction and preserves the old assignment", async () => {
      const prisma = createPrismaMock();
      prisma.vehicle.findFirst
        .mockResolvedValueOnce({
          id: "vehicle-2",
          driverId: null,
          status: VehicleStatus.ACTIVE,
        })
        .mockResolvedValueOnce({
          driverId: null,
          status: VehicleStatus.MAINTENANCE,
        });
      prisma.user.findFirst.mockResolvedValue({ id: "driver-1" });
      prisma.vehicle.updateMany.mockResolvedValueOnce({ count: 0 });
      const service = new VehiclesService(prisma);

      await expect(
        service.assignDriver("tenant-1", "vehicle-2", "driver-1"),
      ).rejects.toThrow("Only active vehicles can be assigned to drivers.");
      expect(prisma.vehicle.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.fleetVehicle.updateMany).not.toHaveBeenCalled();
      expect(prisma.drivers.updateMany).not.toHaveBeenCalled();
    });

    it("rejects a vehicle claimed by another driver before confirmation", async () => {
      const prisma = createPrismaMock();
      prisma.vehicle.findFirst
        .mockResolvedValueOnce({
          id: "vehicle-2",
          driverId: null,
          status: VehicleStatus.ACTIVE,
        })
        .mockResolvedValueOnce({
          driverId: "driver-2",
          status: VehicleStatus.ACTIVE,
        });
      prisma.user.findFirst.mockResolvedValue({ id: "driver-1" });
      prisma.vehicle.updateMany.mockResolvedValueOnce({ count: 0 });
      const service = new VehiclesService(prisma);

      await expect(
        service.assignDriver("tenant-1", "vehicle-2", "driver-1"),
      ).rejects.toThrow("Vehicle is already assigned to another driver.");
      expect(prisma.vehicle.updateMany).toHaveBeenCalledTimes(1);
    });

    it("keeps cross-tenant or missing vehicles inaccessible", async () => {
      const prisma = createPrismaMock();
      prisma.vehicle.findFirst.mockResolvedValue(null);
      const service = new VehiclesService(prisma);

      await expect(
        service.assignDriver("tenant-1", "other-tenant", "driver-1"),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("allows unassigning a non-active vehicle", async () => {
      const prisma = createPrismaMock();
      prisma.vehicle.findFirst.mockResolvedValue({
        id: "vehicle-1",
        driverId: "driver-1",
        status: VehicleStatus.MAINTENANCE,
      });
      prisma.vehicle.update.mockResolvedValue({
        ...activeVehicle,
        status: VehicleStatus.MAINTENANCE,
        driverId: null,
      });
      const service = new VehiclesService(prisma);

      await expect(
        service.assignDriver("tenant-1", "vehicle-1", null),
      ).resolves.toMatchObject({ id: "vehicle-1", driverId: null });
      expect(prisma.vehicle.update).toHaveBeenCalled();
    });

    it("builds tenant-scoped, ACTIVE, unassigned searchable pages with stable ordering", async () => {
      const prisma = createPrismaMock();
      prisma.vehicle.count.mockResolvedValue(125);
      prisma.vehicle.findMany.mockResolvedValue([activeVehicle]);
      const service = new VehiclesService(prisma);

      const result = await service.list("tenant-1", {
        page: 5,
        pageSize: 25,
        q: "hiace",
        eligibleForAssignment: true,
      });

      expect(result.meta).toEqual({ page: 5, pageSize: 25, total: 125 });
      expect(prisma.vehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            driverId: null,
            status: VehicleStatus.ACTIVE,
            AND: [
              {
                OR: expect.arrayContaining([
                  {
                    plateNo: {
                      contains: "hiace",
                      mode: "insensitive",
                    },
                  },
                  {
                    vehicleDescription: {
                      contains: "hiace",
                      mode: "insensitive",
                    },
                  },
                ]),
              },
            ],
          }),
          orderBy: [{ plateNo: "asc" }, { id: "asc" }],
          skip: 100,
          take: 25,
        }),
      );
    });
  });

  describe("fleet vehicles", () => {
    it("enforces the same ACTIVE rule and atomic claim", async () => {
      const prisma = createPrismaMock();
      prisma.fleetVehicle.findFirst.mockResolvedValueOnce({
        id: "fleet-1",
        driverId: null,
        status: VehicleStatus.ACTIVE,
      });
      prisma.user.findFirst.mockResolvedValue({ id: "driver-1" });
      prisma.fleetVehicle.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });
      prisma.fleetVehicle.findUniqueOrThrow.mockResolvedValue({
        ...activeVehicle,
        id: "fleet-1",
        driverId: "driver-1",
      });
      const service = new FleetVehiclesService(prisma);

      await service.assignDriver("tenant-1", "fleet-1", {
        driverId: "driver-1",
      });

      expect(prisma.fleetVehicle.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: "fleet-1",
          tenantId: "tenant-1",
          status: VehicleStatus.ACTIVE,
          OR: [{ driverId: null }, { driverId: "driver-1" }],
        },
        data: { driverId: "driver-1" },
      });
    });

    it.each([VehicleStatus.MAINTENANCE, VehicleStatus.INACTIVE])(
      "rejects a %s fleet vehicle",
      async (status) => {
        const prisma = createPrismaMock();
        prisma.fleetVehicle.findFirst.mockResolvedValue({
          id: "fleet-1",
          driverId: null,
          status,
        });
        const service = new FleetVehiclesService(prisma);

        await expect(
          service.assignDriver("tenant-1", "fleet-1", {
            driverId: "driver-1",
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      },
    );

    it("revalidates fleet eligibility before replacing an existing assignment", async () => {
      const prisma = createPrismaMock();
      prisma.fleetVehicle.findFirst
        .mockResolvedValueOnce({
          id: "fleet-2",
          driverId: null,
          status: VehicleStatus.ACTIVE,
        })
        .mockResolvedValueOnce({
          driverId: "driver-2",
          status: VehicleStatus.ACTIVE,
        });
      prisma.user.findFirst.mockResolvedValue({ id: "driver-1" });
      prisma.fleetVehicle.updateMany.mockResolvedValueOnce({ count: 0 });
      const service = new FleetVehiclesService(prisma);

      await expect(
        service.assignDriver("tenant-1", "fleet-2", {
          driverId: "driver-1",
        }),
      ).rejects.toThrow("Vehicle is already assigned to another driver.");
      expect(prisma.fleetVehicle.updateMany).toHaveBeenCalledTimes(1);
      expect(prisma.vehicle.updateMany).not.toHaveBeenCalled();
      expect(prisma.drivers.updateMany).not.toHaveBeenCalled();
    });

    it("keeps cross-tenant fleet vehicles inaccessible", async () => {
      const prisma = createPrismaMock();
      prisma.fleetVehicle.findFirst.mockResolvedValue(null);
      const service = new FleetVehiclesService(prisma);

      await expect(
        service.assignDriver("tenant-1", "other-tenant", {
          driverId: "driver-1",
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("allows unassigning a non-active fleet vehicle", async () => {
      const prisma = createPrismaMock();
      prisma.fleetVehicle.findFirst.mockResolvedValue({
        id: "fleet-1",
        driverId: "driver-1",
        status: VehicleStatus.INACTIVE,
      });
      prisma.fleetVehicle.update.mockResolvedValue({
        ...activeVehicle,
        id: "fleet-1",
        status: VehicleStatus.INACTIVE,
        driverId: null,
      });
      const service = new FleetVehiclesService(prisma);

      await expect(
        service.assignDriver("tenant-1", "fleet-1", { driverId: null }),
      ).resolves.toMatchObject({ id: "fleet-1", driverId: null });
    });

    it("uses the compatible eligible-list search and pagination contract", async () => {
      const prisma = createPrismaMock();
      prisma.fleetVehicle.count.mockResolvedValue(126);
      prisma.fleetVehicle.findMany.mockResolvedValue([]);
      const service = new FleetVehiclesService(prisma);

      const result = await service.list("tenant-1", {
        page: 6,
        pageSize: 25,
        q: "prime mover",
        eligibleForAssignment: true,
      });

      expect(result.meta).toEqual({ page: 6, pageSize: 25, total: 126 });
      expect(prisma.fleetVehicle.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            tenantId: "tenant-1",
            driverId: null,
            status: VehicleStatus.ACTIVE,
          }),
          orderBy: [{ plateNo: "asc" }, { id: "asc" }],
          skip: 125,
          take: 25,
        }),
      );
    });
  });
});
