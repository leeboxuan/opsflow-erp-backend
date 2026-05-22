import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PushPlatform, Role } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { RegisterPushDeviceDto, PushDeviceDto } from "./dto/push-device.dto";

export interface PushDeviceActorContext {
  tenantId: string;
  userId: string;
  role: Role;
}

@Injectable()
export class PushDevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(
    ctx: PushDeviceActorContext,
    dto: RegisterPushDeviceDto,
  ): Promise<PushDeviceDto> {
    this.assertPushRegistrationAllowed(ctx.role);

    const expoPushToken = normalizeExpoPushToken(dto.expoPushToken);
    const platform = parsePlatform(dto.platform);
    const now = new Date();

    const row = await this.prisma.pushDevice.upsert({
      where: { expoPushToken },
      create: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        platform,
        expoPushToken,
        deviceId: dto.deviceId?.trim() || null,
        appVersion: dto.appVersion?.trim() || null,
        lastSeenAt: now,
        disabledAt: null,
      },
      update: {
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        platform,
        deviceId: dto.deviceId?.trim() || null,
        appVersion: dto.appVersion?.trim() || null,
        lastSeenAt: now,
        disabledAt: null,
      },
    });

    return toPushDeviceDto(row);
  }

  async unregisterByToken(
    ctx: PushDeviceActorContext,
    expoPushTokenRaw: string,
  ): Promise<{ ok: true }> {
    this.assertPushRegistrationAllowed(ctx.role);

    const expoPushToken = normalizeExpoPushToken(expoPushTokenRaw);
    const device = await this.prisma.pushDevice.findUnique({
      where: { expoPushToken },
    });

    if (!device) {
      throw new NotFoundException("Push device not found");
    }
    if (device.tenantId !== ctx.tenantId || device.userId !== ctx.userId) {
      throw new ForbiddenException("Push device not registered to current user");
    }

    await this.prisma.pushDevice.update({
      where: { id: device.id },
      data: { disabledAt: new Date() },
    });

    return { ok: true };
  }

  private assertPushRegistrationAllowed(role: Role): void {
    if (role === Role.CUSTOMER) {
      throw new ForbiddenException("Push notifications are not available for customer users");
    }
  }
}

export function normalizeExpoPushToken(token: string): string {
  const trimmed = token?.trim();
  if (!trimmed || trimmed.length < 10) {
    throw new BadRequestException("expoPushToken is required");
  }
  if (
    !trimmed.startsWith("ExponentPushToken[") &&
    !trimmed.startsWith("ExpoPushToken[")
  ) {
    throw new BadRequestException("expoPushToken format is invalid");
  }
  return trimmed;
}

function parsePlatform(raw?: string): PushPlatform {
  if (raw === "ios") return PushPlatform.ios;
  if (raw === "android") return PushPlatform.android;
  return PushPlatform.unknown;
}

function toPushDeviceDto(row: {
  id: string;
  tenantId: string;
  userId: string;
  platform: PushPlatform;
  expoPushToken: string;
  deviceId: string | null;
  appVersion: string | null;
  lastSeenAt: Date;
  disabledAt: Date | null;
}): PushDeviceDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    platform: row.platform,
    expoPushToken: row.expoPushToken,
    deviceId: row.deviceId,
    appVersion: row.appVersion,
    lastSeenAt: row.lastSeenAt,
    disabledAt: row.disabledAt,
  };
}
