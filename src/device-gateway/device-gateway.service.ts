import { Injectable, NotFoundException, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RealtimeEventsService } from "../realtime/realtime-events.service";
import { DeviceGatewayEventDto } from "./dto/device-gateway-event.dto";

export type DeviceGatewayEventResult = {
  ok: true;
  gpsDeviceId: string;
  chassisId: string | null;
  vehicleId: string | null;
  driverId: string | null;
  lat: number;
  lng: number;
  recordedAt: string;
};

@Injectable()
export class DeviceGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly realtime?: RealtimeEventsService,
  ) {}

  async ingestLocationEvent(
    dto: DeviceGatewayEventDto,
  ): Promise<DeviceGatewayEventResult> {
    const device = await this.prisma.gpsDevice.findFirst({
      where: {
        terminalId: dto.terminalId.trim(),
        isActive: true,
      },
    });

    if (!device) {
      throw new NotFoundException("GPS device not registered");
    }

    const { payload } = dto;
    const recordedAt = new Date(payload.recordedAt);
    const lat = new Prisma.Decimal(payload.lat);
    const lng = new Prisma.Decimal(payload.lng);
    const receivedAt = new Date();

    await this.prisma.$transaction([
      this.prisma.gpsPosition.create({
        data: {
          tenantId: device.tenantId,
          gpsDeviceId: device.id,
          chassisId: device.chassisId,
          vehicleId: device.vehicleId,
          driverId: device.driverId,
          lat,
          lng,
          speedKph: payload.speedKph ?? null,
          heading:
            payload.heading === undefined || payload.heading === null
              ? null
              : Math.trunc(payload.heading),
          altitude: payload.altitude ?? null,
          recordedAt,
          receivedAt,
          rawProtocol: dto.protocol,
          rawMessageId: payload.rawMessageId?.trim() || null,
          rawPayload:
            payload.rawPayload === undefined ? undefined : payload.rawPayload,
        },
      }),
      this.prisma.gpsDevice.update({
        where: { id: device.id },
        data: {
          lastSeenAt: receivedAt,
          lastLat: lat,
          lastLng: lng,
          lastSpeedKph: payload.speedKph ?? null,
          lastHeading:
            payload.heading === undefined || payload.heading === null
              ? null
              : Math.trunc(payload.heading),
        },
      }),
    ]);

    const result: DeviceGatewayEventResult = {
      ok: true,
      gpsDeviceId: device.id,
      chassisId: device.chassisId,
      vehicleId: device.vehicleId,
      driverId: device.driverId,
      lat: payload.lat,
      lng: payload.lng,
      recordedAt: recordedAt.toISOString(),
    };

    this.realtime?.publish({
      type: "asset.location.updated",
      tenantId: device.tenantId,
      entityType: "asset",
      entityId: device.chassisId ?? device.id,
      driverUserId: device.driverId ?? undefined,
      assetType: "CHASSIS",
      chassisId: device.chassisId,
      vehicleId: device.vehicleId,
      gpsDeviceId: device.id,
      terminalId: device.terminalId,
      lat: payload.lat,
      lng: payload.lng,
      speedKph: payload.speedKph ?? null,
      heading:
        payload.heading === undefined || payload.heading === null
          ? null
          : Math.trunc(payload.heading),
      altitude: payload.altitude ?? null,
      recordedAt: recordedAt.toISOString(),
      receivedAt: receivedAt.toISOString(),
      status: "LIVE",
      source: "GPS_TRACKER",
    });

    return result;
  }
}
