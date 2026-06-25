import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { DeviceGatewayService } from "./device-gateway.service";

describe("DeviceGatewayService", () => {
  const device = {
    id: "gps-device-1",
    tenantId: "tenant-1",
    chassisId: "chassis-1",
    vehicleId: "vehicle-1",
    driverId: "driver-1",
    terminalId: "123456789012",
    isActive: true,
  };

  function makeService() {
    const gpsPositionCreate = jest.fn().mockResolvedValue({ id: "pos-1" });
    const gpsDeviceUpdate = jest.fn().mockResolvedValue(device);
    const transaction = jest.fn(async (ops: unknown[]) => {
      for (const op of ops) {
        await op;
      }
    });

    const prisma = {
      gpsDevice: {
        findFirst: jest.fn().mockResolvedValue(device),
        update: gpsDeviceUpdate,
      },
      gpsPosition: {
        create: gpsPositionCreate,
      },
      $transaction: transaction,
    };

    const realtime = { publish: jest.fn() };
    const svc = new DeviceGatewayService(prisma as any, realtime as any);
    return { svc, prisma, gpsPositionCreate, gpsDeviceUpdate, transaction, realtime };
  }

  const eventBody = {
    protocol: "JT808" as const,
    deviceType: "GPS_TRACKER" as const,
    terminalId: "123456789012",
    event: "LOCATION" as const,
    payload: {
      lat: 1.3521,
      lng: 103.8198,
      speedKph: 42.5,
      heading: 180,
      altitude: 12.3,
      recordedAt: "2026-05-21T12:34:56.000Z",
      rawMessageId: "msg-1",
      rawPayload: { source: "jt808" },
    },
  };

  it("returns 404 when active GPS device is not registered", async () => {
    const { svc, prisma } = makeService();
    prisma.gpsDevice.findFirst.mockResolvedValue(null);

    await expect(svc.ingestLocationEvent(eventBody)).rejects.toThrow(
      new NotFoundException("GPS device not registered"),
    );
  });

  it("inserts GpsPosition and updates GpsDevice snapshot", async () => {
    const { svc, gpsPositionCreate, gpsDeviceUpdate, transaction, realtime } = makeService();

    const result = await svc.ingestLocationEvent(eventBody);

    expect(transaction).toHaveBeenCalled();
    expect(gpsPositionCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "tenant-1",
        gpsDeviceId: "gps-device-1",
        chassisId: "chassis-1",
        vehicleId: "vehicle-1",
        driverId: "driver-1",
        lat: new Prisma.Decimal(1.3521),
        lng: new Prisma.Decimal(103.8198),
        speedKph: 42.5,
        heading: 180,
        altitude: 12.3,
        recordedAt: new Date("2026-05-21T12:34:56.000Z"),
        rawProtocol: "JT808",
        rawMessageId: "msg-1",
        rawPayload: { source: "jt808" },
      }),
    });
    expect(gpsDeviceUpdate).toHaveBeenCalledWith({
      where: { id: "gps-device-1" },
      data: expect.objectContaining({
        lastLat: new Prisma.Decimal(1.3521),
        lastLng: new Prisma.Decimal(103.8198),
        lastSpeedKph: 42.5,
        lastHeading: 180,
        lastSeenAt: expect.any(Date),
      }),
    });
    expect(result).toEqual({
      ok: true,
      gpsDeviceId: "gps-device-1",
      chassisId: "chassis-1",
      vehicleId: "vehicle-1",
      driverId: "driver-1",
      lat: 1.3521,
      lng: 103.8198,
      recordedAt: "2026-05-21T12:34:56.000Z",
    });
    expect(realtime.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "asset.location.updated",
        tenantId: "tenant-1",
        assetType: "CHASSIS",
        chassisId: "chassis-1",
        vehicleId: "vehicle-1",
        driverUserId: "driver-1",
        gpsDeviceId: "gps-device-1",
        terminalId: "123456789012",
        status: "LIVE",
        source: "GPS_TRACKER",
      }),
    );
  });
});
