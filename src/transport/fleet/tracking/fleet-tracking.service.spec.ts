import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { FleetTrackingService } from "./fleet-tracking.service";

describe("FleetTrackingService", () => {
  function makePrisma() {
    const prisma: any = {
      chassis: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
      },
      gpsDevice: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        count: jest.fn(),
      },
      gpsPosition: {
        count: jest.fn(),
      },
      $transaction: jest.fn(async (arg: any) => {
        if (typeof arg === "function") return arg(prisma);
        return Promise.all(arg);
      }),
    };

    return prisma;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejects duplicate chassis create", async () => {
    const prisma = makePrisma();
    prisma.chassis.findUnique.mockResolvedValue({ id: "existing" });
    const svc = new FleetTrackingService(prisma, { log: jest.fn() } as any);

    await expect(
      svc.createChassis("tenant-1", { chassisNo: " tclu123 ", status: "ACTIVE" }),
    ).rejects.toThrow(new BadRequestException("Chassis number already exists"));
  });

  it("creates GPS device preserving terminalId leading zeroes", async () => {
    const prisma = makePrisma();
    prisma.gpsDevice.findFirst.mockResolvedValue(null);
    prisma.gpsDevice.create.mockResolvedValue({
      id: "dev-1",
      tenantId: "tenant-1",
      terminalId: "001234567890",
      imei: null,
      simNumber: null,
      model: "TK905B-4G",
      protocol: "JT808",
      isActive: true,
      chassisId: null,
      chassis: null,
      lastSeenAt: null,
      lastLat: null,
      lastLng: null,
      lastSpeedKph: null,
      lastHeading: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const svc = new FleetTrackingService(prisma, { log: jest.fn() } as any);
    const result = await svc.createGpsDevice("tenant-1", { terminalId: "001234567890" });

    expect(prisma.gpsDevice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ terminalId: "001234567890" }),
      }),
    );
    expect(result.terminalId).toBe("001234567890");
  });

  it("assigns device to chassis and clears previous active device", async () => {
    const prisma = makePrisma();
    prisma.gpsDevice.findFirst.mockResolvedValueOnce({
      id: "dev-2",
      tenantId: "tenant-1",
      chassisId: null,
    });
    prisma.chassis.findFirst.mockResolvedValue({ id: "chassis-1", tenantId: "tenant-1" });
    prisma.gpsDevice.update.mockResolvedValue({
      id: "dev-2",
      tenantId: "tenant-1",
      terminalId: "123",
      imei: null,
      simNumber: null,
      model: "TK905B-4G",
      protocol: "JT808",
      isActive: true,
      chassisId: "chassis-1",
      chassis: { id: "chassis-1", chassisNo: "TCLU1234567", label: null, status: "ACTIVE" },
      lastSeenAt: null,
      lastLat: null,
      lastLng: null,
      lastSpeedKph: null,
      lastHeading: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const svc = new FleetTrackingService(prisma, { log: jest.fn() } as any);
    await svc.assignGpsDeviceChassis("tenant-1", "dev-2", { chassisId: "chassis-1" });

    expect(prisma.gpsDevice.updateMany).toHaveBeenCalledWith({
      where: { tenantId: "tenant-1", chassisId: "chassis-1", isActive: true, id: { not: "dev-2" } },
      data: { chassisId: null },
    });
    expect(prisma.gpsDevice.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dev-2" },
        data: { chassisId: "chassis-1" },
      }),
    );
  });

  it("calculates chassis tracking statuses ONLINE/STALE/OFFLINE/UNASSIGNED", async () => {
    const prisma = makePrisma();
    const baseNow = Date.now();
    prisma.chassis.count.mockResolvedValue(4);
    prisma.chassis.findMany.mockResolvedValue([
      {
        id: "c-online",
        tenantId: "tenant-1",
        chassisNo: "ONL1",
        label: null,
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        gpsDevices: [{
          id: "d1",
          terminalId: "1",
          imei: null,
          simNumber: null,
          model: "TK905B-4G",
          protocol: "JT808",
          isActive: true,
          lastSeenAt: new Date(baseNow - 60 * 1000),
          lastLat: new Prisma.Decimal("1.3"),
          lastLng: new Prisma.Decimal("103.8"),
          lastSpeedKph: 12,
          lastHeading: 90,
        }],
      },
      {
        id: "c-stale",
        tenantId: "tenant-1",
        chassisNo: "STL1",
        label: null,
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        gpsDevices: [{
          id: "d2",
          terminalId: "2",
          imei: null,
          simNumber: null,
          model: "TK905B-4G",
          protocol: "JT808",
          isActive: true,
          lastSeenAt: new Date(baseNow - 10 * 60 * 1000),
          lastLat: null,
          lastLng: null,
          lastSpeedKph: null,
          lastHeading: null,
        }],
      },
      {
        id: "c-offline",
        tenantId: "tenant-1",
        chassisNo: "OFF1",
        label: null,
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        gpsDevices: [{
          id: "d3",
          terminalId: "3",
          imei: null,
          simNumber: null,
          model: "TK905B-4G",
          protocol: "JT808",
          isActive: true,
          lastSeenAt: new Date(baseNow - 40 * 60 * 1000),
          lastLat: null,
          lastLng: null,
          lastSpeedKph: null,
          lastHeading: null,
        }],
      },
      {
        id: "c-unassigned",
        tenantId: "tenant-1",
        chassisNo: "UNA1",
        label: null,
        status: "ACTIVE",
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        gpsDevices: [],
      },
    ]);

    const svc = new FleetTrackingService(prisma, { log: jest.fn() } as any);
    const result = await svc.listChassis("tenant-1", {} as any);

    expect(result.data.map((d) => d.trackingStatus)).toEqual([
      "ONLINE",
      "STALE",
      "OFFLINE",
      "UNASSIGNED",
    ]);
  });

  it("enforces tenant isolation on chassis and gps device lookup", async () => {
    const prisma = makePrisma();
    prisma.chassis.findFirst.mockResolvedValue(null);
    prisma.gpsDevice.findFirst.mockResolvedValue(null);

    const svc = new FleetTrackingService(prisma, { log: jest.fn() } as any);

    await expect(svc.getChassisById("tenant-1", "c-1")).rejects.toThrow(
      new NotFoundException("Chassis not found"),
    );
    await expect(svc.getGpsDeviceById("tenant-1", "g-1")).rejects.toThrow(
      new NotFoundException("GPS device not found"),
    );
  });

  it("creates company-owned chassis by default", async () => {
    const prisma = makePrisma();
    const audit = { log: jest.fn() };
    prisma.chassis.findUnique.mockResolvedValue(null);
    prisma.chassis.create.mockResolvedValue({
      id: "c-new",
      tenantId: "tenant-1",
      chassisNo: "TRD1",
      label: null,
      status: "ACTIVE",
      notes: null,
      isBorrowed: false,
      borrowedFromCompany: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      gpsDevices: [],
    });

    const svc = new FleetTrackingService(prisma, audit as any);
    const result = await svc.createChassis("tenant-1", { chassisNo: "trd1" }, "user-1");

    expect(prisma.chassis.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          chassisNo: "TRD1",
          isBorrowed: false,
          borrowedFromCompany: null,
        }),
      }),
    );
    expect(result.isBorrowed).toBe(false);
    expect(result.ownershipLabel).toBe("Company-owned");
    expect(audit.log).toHaveBeenCalledWith(
      "tenant-1",
      "CREATE",
      "CHASSIS",
      "c-new",
      expect.objectContaining({ isBorrowed: false }),
      "user-1",
    );
  });

  it("requires borrowed company and clears it when unmarked", async () => {
    const prisma = makePrisma();
    const audit = { log: jest.fn() };
    prisma.chassis.findUnique.mockResolvedValue(null);
    prisma.chassis.create.mockResolvedValue({
      id: "c-borrowed",
      tenantId: "tenant-1",
      chassisNo: "TRD2",
      label: null,
      status: "ACTIVE",
      notes: null,
      isBorrowed: true,
      borrowedFromCompany: "Acme",
      createdAt: new Date(),
      updatedAt: new Date(),
      gpsDevices: [],
    });

    const svc = new FleetTrackingService(prisma, audit as any);

    await expect(
      svc.createChassis("tenant-1", { chassisNo: "TRD2", isBorrowed: true }),
    ).rejects.toThrow(BadRequestException);

    await svc.createChassis("tenant-1", {
      chassisNo: "TRD2",
      isBorrowed: true,
      borrowedFromCompany: " Acme ",
    });

    prisma.chassis.findFirst.mockResolvedValue({
      id: "c-borrowed",
      tenantId: "tenant-1",
      chassisNo: "TRD2",
      isBorrowed: true,
      borrowedFromCompany: "Acme",
    });
    prisma.chassis.update.mockResolvedValue({
      id: "c-borrowed",
      tenantId: "tenant-1",
      chassisNo: "TRD2",
      label: null,
      status: "ACTIVE",
      notes: null,
      isBorrowed: false,
      borrowedFromCompany: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      gpsDevices: [],
    });

    const updated = await svc.updateChassis(
      "tenant-1",
      "c-borrowed",
      { isBorrowed: false },
      "user-1",
    );
    expect(prisma.chassis.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isBorrowed: false,
          borrowedFromCompany: null,
        }),
      }),
    );
    expect(updated.ownershipLabel).toBe("Company-owned");
  });
});
