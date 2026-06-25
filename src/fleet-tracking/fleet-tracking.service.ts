import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { applyQSearch } from "../common/listing/listing.search";
import { buildOrderBy } from "../common/listing/listing.sort";
import { buildPaginationMeta, parsePaginationFromQuery } from "../common/pagination";
import { PrismaService } from "../prisma/prisma.service";
import { AssignGpsDeviceChassisDto } from "./dto/assign-gps-device-chassis.dto";
import { CreateChassisDto } from "./dto/create-chassis.dto";
import { CreateGpsDeviceDto } from "./dto/create-gps-device.dto";
import { CHASSIS_SORT_FIELDS, ListChassisQueryDto } from "./dto/list-chassis-query.dto";
import {
  GPS_DEVICE_SORT_FIELDS,
  ListGpsDevicesQueryDto,
} from "./dto/list-gps-devices-query.dto";
import { UpdateChassisDto } from "./dto/update-chassis.dto";
import { UpdateGpsDeviceDto } from "./dto/update-gps-device.dto";
import {
  DeleteChassisResult,
  FleetTrackingChassisDto,
  FleetTrackingGpsDeviceDto,
  ChassisHistoryResponse,
  ListFleetTrackingChassisResult,
  ListFleetTrackingGpsDevicesResult,
  LiveChassisLocationsResponse,
  TrackingStatus,
} from "./fleet-tracking.types";
import {
  computeHistorySummary,
  decimalToNumber,
  detectHistoryStops,
  downsampleHistoryPoints,
  getSafeTenantTimezone,
  isValidCoordinate,
  parseCalendarDateToUtcRangeInTimeZone,
  ValidHistoryPoint,
} from "./fleet-tracking.helpers";
import { ChassisHistoryQueryDto } from "./dto/chassis-history-query.dto";

const ONLINE_SECONDS = 5 * 60;
const STALE_SECONDS = 30 * 60;

function ageSeconds(lastSeenAt: Date | null | undefined, now: Date): number | null {
  if (!lastSeenAt) return null;
  return Math.max(0, Math.floor((now.getTime() - lastSeenAt.getTime()) / 1000));
}

function statusFromAge(age: number | null): TrackingStatus {
  if (age === null) return "OFFLINE";
  if (age <= ONLINE_SECONDS) return "ONLINE";
  if (age <= STALE_SECONDS) return "STALE";
  return "OFFLINE";
}

function mapGpsDeviceHealth(device: any): {
  lastBatteryVoltageMv: number | null;
  lastBatteryVoltage: number | null;
  lastBatterySeenAt: Date | null;
  lastSignalStrength: number | null;
  lastSatelliteCount: number | null;
} {
  if (!device) {
    return {
      lastBatteryVoltageMv: null,
      lastBatteryVoltage: null,
      lastBatterySeenAt: null,
      lastSignalStrength: null,
      lastSatelliteCount: null,
    };
  }

  return {
    lastBatteryVoltageMv: device.lastBatteryVoltageMv ?? null,
    lastBatteryVoltage: decimalToNumber(device.lastBatteryVoltage),
    lastBatterySeenAt: device.lastBatterySeenAt ?? null,
    lastSignalStrength: device.lastSignalStrength ?? null,
    lastSatelliteCount: device.lastSatelliteCount ?? null,
  };
}

@Injectable()
export class FleetTrackingService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeChassisNo(value: string): string {
    return String(value ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
  }

  private normalizeTerminalId(value: string): string {
    return String(value ?? "").trim();
  }

  private mapChassisRow(row: any, now: Date): FleetTrackingChassisDto {
    const assigned = row.gpsDevices?.[0] ?? null;
    const assignedAge = ageSeconds(assigned?.lastSeenAt ?? null, now);
    const trackingStatus: TrackingStatus =
      assigned && assigned.isActive ? statusFromAge(assignedAge) : "UNASSIGNED";
    const health = mapGpsDeviceHealth(assigned);

    return {
      id: row.id,
      tenantId: row.tenantId,
      chassisNo: row.chassisNo,
      label: row.label ?? null,
      status: row.status,
      notes: row.notes ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      assignedGpsDevice: assigned
        ? {
            id: assigned.id,
            terminalId: assigned.terminalId,
            imei: assigned.imei ?? null,
            simNumber: assigned.simNumber ?? null,
            model: assigned.model,
            protocol: assigned.protocol,
            isActive: assigned.isActive,
            lastSeenAt: assigned.lastSeenAt ?? null,
            lastLat: decimalToNumber(assigned.lastLat),
            lastLng: decimalToNumber(assigned.lastLng),
            lastSpeedKph: assigned.lastSpeedKph ?? null,
            lastHeading: assigned.lastHeading ?? null,
            ...health,
          }
        : null,
      trackingStatus,
      lastSeenAt: assigned?.lastSeenAt ?? null,
      lastLat: decimalToNumber(assigned?.lastLat),
      lastLng: decimalToNumber(assigned?.lastLng),
      lastSpeedKph: assigned?.lastSpeedKph ?? null,
      lastHeading: assigned?.lastHeading ?? null,
      ...health,
      ageSeconds: trackingStatus === "UNASSIGNED" ? null : assignedAge,
    };
  }

  private mapGpsDeviceRow(row: any, now: Date): FleetTrackingGpsDeviceDto {
    const age = ageSeconds(row.lastSeenAt ?? null, now);
    const trackingStatus: TrackingStatus = row.chassisId
      ? row.isActive
        ? statusFromAge(age)
        : "OFFLINE"
      : "UNASSIGNED";
    const health = mapGpsDeviceHealth(row);

    return {
      id: row.id,
      tenantId: row.tenantId,
      terminalId: row.terminalId,
      imei: row.imei ?? null,
      simNumber: row.simNumber ?? null,
      model: row.model,
      protocol: row.protocol,
      isActive: row.isActive,
      chassisId: row.chassisId ?? null,
      chassis: row.chassis
        ? {
            id: row.chassis.id,
            chassisNo: row.chassis.chassisNo,
            label: row.chassis.label ?? null,
            status: row.chassis.status,
          }
        : null,
      lastSeenAt: row.lastSeenAt ?? null,
      lastLat: decimalToNumber(row.lastLat),
      lastLng: decimalToNumber(row.lastLng),
      lastSpeedKph: row.lastSpeedKph ?? null,
      lastHeading: row.lastHeading ?? null,
      ...health,
      trackingStatus,
      ageSeconds: trackingStatus === "UNASSIGNED" ? null : age,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private trackingStatusWhere(status: TrackingStatus, now: Date): Prisma.ChassisWhereInput {
    const onlineCutoff = new Date(now.getTime() - ONLINE_SECONDS * 1000);
    const staleCutoff = new Date(now.getTime() - STALE_SECONDS * 1000);

    if (status === "UNASSIGNED") {
      return { gpsDevices: { none: { isActive: true } } };
    }
    if (status === "ONLINE") {
      return { gpsDevices: { some: { isActive: true, lastSeenAt: { gte: onlineCutoff } } } };
    }
    if (status === "STALE") {
      return {
        gpsDevices: {
          some: {
            isActive: true,
            lastSeenAt: { lt: onlineCutoff, gte: staleCutoff },
          },
        },
      };
    }
    return {
      AND: [
        { gpsDevices: { some: { isActive: true } } },
        { NOT: { gpsDevices: { some: { isActive: true, lastSeenAt: { gte: staleCutoff } } } } },
      ],
    };
  }

  async listChassis(
    tenantId: string,
    query: ListChassisQueryDto,
  ): Promise<ListFleetTrackingChassisResult> {
    const now = new Date();
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
    const where: Prisma.ChassisWhereInput = { tenantId };

    if (query.status) where.status = query.status;
    applyQSearch(where as any, query.q, ["chassisNo", "label", "notes"]);
    if (query.trackingStatus) {
      const existingAnd = Array.isArray(where.AND)
        ? where.AND
        : where.AND
          ? [where.AND]
          : [];
      where.AND = [
        ...existingAnd,
        this.trackingStatusWhere(query.trackingStatus, now),
      ];
    }

    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortDir,
      [...CHASSIS_SORT_FIELDS],
      { createdAt: "desc" },
    );

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.chassis.count({ where }),
      this.prisma.chassis.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          gpsDevices: {
            where: { isActive: true },
            take: 1,
            orderBy: [{ lastSeenAt: "desc" }, { updatedAt: "desc" }],
          },
        },
      }),
    ]);

    return {
      data: rows.map((row) => this.mapChassisRow(row, now)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async createChassis(tenantId: string, dto: CreateChassisDto): Promise<FleetTrackingChassisDto> {
    const chassisNo = this.normalizeChassisNo(dto.chassisNo);
    const existing = await this.prisma.chassis.findUnique({
      where: { tenantId_chassisNo: { tenantId, chassisNo } },
    });
    if (existing) throw new BadRequestException("Chassis number already exists");

    const created = await this.prisma.chassis.create({
      data: {
        tenantId,
        chassisNo,
        label: dto.label?.trim() || null,
        status: dto.status?.trim() || "ACTIVE",
        notes: dto.notes?.trim() || null,
      },
      include: { gpsDevices: { where: { isActive: true }, take: 1 } },
    });
    return this.mapChassisRow(created, new Date());
  }

  async getChassisById(tenantId: string, id: string): Promise<FleetTrackingChassisDto> {
    const row = await this.prisma.chassis.findFirst({
      where: { id, tenantId },
      include: {
        gpsDevices: {
          where: { isActive: true },
          take: 1,
          orderBy: [{ lastSeenAt: "desc" }, { updatedAt: "desc" }],
        },
      },
    });
    if (!row) throw new NotFoundException("Chassis not found");
    return this.mapChassisRow(row, new Date());
  }

  async updateChassis(
    tenantId: string,
    id: string,
    dto: UpdateChassisDto,
  ): Promise<FleetTrackingChassisDto> {
    const row = await this.prisma.chassis.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("Chassis not found");

    const chassisNo =
      dto.chassisNo !== undefined ? this.normalizeChassisNo(dto.chassisNo) : undefined;

    if (chassisNo !== undefined) {
      const dup = await this.prisma.chassis.findFirst({
        where: { tenantId, chassisNo, id: { not: id } },
      });
      if (dup) throw new BadRequestException("Chassis number already exists");
    }

    const updated = await this.prisma.chassis.update({
      where: { id },
      data: {
        ...(chassisNo !== undefined && { chassisNo }),
        ...(dto.label !== undefined && { label: dto.label?.trim() || null }),
        ...(dto.status !== undefined && { status: dto.status?.trim() || "ACTIVE" }),
        ...(dto.notes !== undefined && { notes: dto.notes?.trim() || null }),
      },
      include: {
        gpsDevices: {
          where: { isActive: true },
          take: 1,
          orderBy: [{ lastSeenAt: "desc" }, { updatedAt: "desc" }],
        },
      },
    });

    return this.mapChassisRow(updated, new Date());
  }

  async deleteChassis(tenantId: string, id: string): Promise<DeleteChassisResult> {
    const row = await this.prisma.chassis.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("Chassis not found");

    const positions = await this.prisma.gpsPosition.count({ where: { tenantId, chassisId: id } });
    if (positions > 0) {
      await this.prisma.$transaction([
        this.prisma.chassis.update({ where: { id }, data: { status: "INACTIVE" } }),
        this.prisma.gpsDevice.updateMany({ where: { tenantId, chassisId: id }, data: { chassisId: null } }),
      ]);
      return { id, deleted: false, deactivated: true };
    }

    await this.prisma.chassis.delete({ where: { id } });
    return { id, deleted: true, deactivated: false };
  }

  async listGpsDevices(
    tenantId: string,
    query: ListGpsDevicesQueryDto,
  ): Promise<ListFleetTrackingGpsDevicesResult> {
    const now = new Date();
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);
    const where: Prisma.GpsDeviceWhereInput = { tenantId };

    if (query.isActive !== undefined) {
      where.isActive = query.isActive === "true";
    }
    if (query.assignment === "assigned") where.chassisId = { not: null };
    if (query.assignment === "unassigned") where.chassisId = null;

    applyQSearch(where as any, query.q, ["terminalId", "imei", "simNumber", "model", "protocol"]);

    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortDir,
      [...GPS_DEVICE_SORT_FIELDS],
      { createdAt: "desc" },
    );

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.gpsDevice.count({ where }),
      this.prisma.gpsDevice.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          chassis: { select: { id: true, chassisNo: true, label: true, status: true } },
        },
      }),
    ]);

    return {
      data: rows.map((row) => this.mapGpsDeviceRow(row, now)),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async createGpsDevice(
    tenantId: string,
    dto: CreateGpsDeviceDto,
  ): Promise<FleetTrackingGpsDeviceDto> {
    const terminalId = this.normalizeTerminalId(dto.terminalId);
    const existingTerminal = await this.prisma.gpsDevice.findFirst({ where: { terminalId } });
    if (existingTerminal) {
      throw new BadRequestException("terminalId already exists");
    }

    const chassisId = dto.chassisId?.trim() || null;
    if (chassisId) {
      const chassis = await this.prisma.chassis.findFirst({ where: { id: chassisId, tenantId } });
      if (!chassis) throw new BadRequestException("Chassis not found");
    }

    const created = await this.prisma.$transaction(async (tx) => {
      if (chassisId) {
        await tx.gpsDevice.updateMany({
          where: { tenantId, chassisId, isActive: true },
          data: { chassisId: null },
        });
      }

      return tx.gpsDevice.create({
        data: {
          tenantId,
          terminalId,
          imei: dto.imei?.trim() || null,
          simNumber: dto.simNumber?.trim() || null,
          model: dto.model?.trim() || "TK905B-4G",
          protocol: dto.protocol?.trim() || "JT808",
          isActive: dto.isActive ?? true,
          chassisId,
        },
        include: {
          chassis: { select: { id: true, chassisNo: true, label: true, status: true } },
        },
      });
    });

    return this.mapGpsDeviceRow(created, new Date());
  }

  async getGpsDeviceById(tenantId: string, id: string): Promise<FleetTrackingGpsDeviceDto> {
    const row = await this.prisma.gpsDevice.findFirst({
      where: { id, tenantId },
      include: {
        chassis: { select: { id: true, chassisNo: true, label: true, status: true } },
      },
    });
    if (!row) throw new NotFoundException("GPS device not found");
    return this.mapGpsDeviceRow(row, new Date());
  }

  async updateGpsDevice(
    tenantId: string,
    id: string,
    dto: UpdateGpsDeviceDto,
  ): Promise<FleetTrackingGpsDeviceDto> {
    const row = await this.prisma.gpsDevice.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("GPS device not found");

    const terminalId =
      dto.terminalId !== undefined ? this.normalizeTerminalId(dto.terminalId) : undefined;

    if (terminalId !== undefined) {
      const dup = await this.prisma.gpsDevice.findFirst({
        where: { terminalId, id: { not: id } },
      });
      if (dup) throw new BadRequestException("terminalId already exists");
    }

    const updated = await this.prisma.gpsDevice.update({
      where: { id },
      data: {
        ...(terminalId !== undefined && { terminalId }),
        ...(dto.imei !== undefined && { imei: dto.imei?.trim() || null }),
        ...(dto.simNumber !== undefined && { simNumber: dto.simNumber?.trim() || null }),
        ...(dto.model !== undefined && { model: dto.model?.trim() || "TK905B-4G" }),
        ...(dto.protocol !== undefined && { protocol: dto.protocol?.trim() || "JT808" }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: {
        chassis: { select: { id: true, chassisNo: true, label: true, status: true } },
      },
    });
    return this.mapGpsDeviceRow(updated, new Date());
  }

  async assignGpsDeviceChassis(
    tenantId: string,
    id: string,
    dto: AssignGpsDeviceChassisDto,
  ): Promise<FleetTrackingGpsDeviceDto> {
    const row = await this.prisma.gpsDevice.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException("GPS device not found");

    const chassisId = dto.chassisId?.trim() || null;
    if (chassisId) {
      const chassis = await this.prisma.chassis.findFirst({ where: { id: chassisId, tenantId } });
      if (!chassis) throw new BadRequestException("Chassis not found");
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (chassisId) {
        await tx.gpsDevice.updateMany({
          where: { tenantId, chassisId, isActive: true, id: { not: id } },
          data: { chassisId: null },
        });
      }

      return tx.gpsDevice.update({
        where: { id },
        data: { chassisId },
        include: {
          chassis: { select: { id: true, chassisNo: true, label: true, status: true } },
        },
      });
    });

    return this.mapGpsDeviceRow(updated, new Date());
  }

  async liveChassisLocations(tenantId: string): Promise<LiveChassisLocationsResponse> {
    const now = new Date();
    const rows = await this.prisma.chassis.findMany({
      where: {
        tenantId,
        status: { not: "INACTIVE" },
      },
      orderBy: [{ updatedAt: "desc" }],
      include: {
        gpsDevices: {
          where: { isActive: true },
          take: 1,
          orderBy: [{ lastSeenAt: "desc" }, { updatedAt: "desc" }],
        },
      },
    });

    return {
      generatedAt: now.toISOString(),
      items: rows.map((row) => {
        const device = row.gpsDevices?.[0] ?? null;
        const age = ageSeconds(device?.lastSeenAt ?? null, now);
        const trackingStatus: TrackingStatus =
          device && device.isActive ? statusFromAge(age) : "UNASSIGNED";
        const health = mapGpsDeviceHealth(device);

        return {
          chassisId: row.id,
          chassisNo: row.chassisNo,
          label: row.label ?? null,
          chassisStatus: row.status,
          gpsDeviceId: device?.id ?? null,
          terminalId: device?.terminalId ?? null,
          imei: device?.imei ?? null,
          simNumber: device?.simNumber ?? null,
          model: device?.model ?? null,
          protocol: device?.protocol ?? null,
          isDeviceActive: device?.isActive ?? null,
          trackingStatus,
          lastSeenAt: device?.lastSeenAt?.toISOString() ?? null,
          lat: decimalToNumber(device?.lastLat),
          lng: decimalToNumber(device?.lastLng),
          speedKph: device?.lastSpeedKph ?? null,
          heading: device?.lastHeading ?? null,
          lastBatteryVoltageMv: health.lastBatteryVoltageMv,
          lastBatteryVoltage: health.lastBatteryVoltage,
          lastBatterySeenAt: health.lastBatterySeenAt?.toISOString() ?? null,
          lastSignalStrength: health.lastSignalStrength,
          lastSatelliteCount: health.lastSatelliteCount,
          ageSeconds: trackingStatus === "UNASSIGNED" ? null : age,
        };
      }),
    };
  }

  private async getTenantTimezone(tenantId: string): Promise<string> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { timezone: true },
    });
    return getSafeTenantTimezone(tenant?.timezone);
  }

  async getChassisHistory(
    tenantId: string,
    chassisId: string,
    query: ChassisHistoryQueryDto,
  ): Promise<ChassisHistoryResponse> {
    const date = query.date;
    const stopMinutes = query.stopMinutes ?? 10;
    const stopRadiusMeters = query.stopRadiusMeters ?? 50;

    const chassis = await this.prisma.chassis.findFirst({
      where: { id: chassisId, tenantId },
      select: { id: true, chassisNo: true, label: true },
    });
    if (!chassis) throw new NotFoundException("Chassis not found");

    const timezone = await this.getTenantTimezone(tenantId);
    const dayWindow = parseCalendarDateToUtcRangeInTimeZone(date, timezone);

    const rows = await this.prisma.gpsPosition.findMany({
      where: {
        tenantId,
        chassisId,
        recordedAt: { gte: dayWindow.gte, lt: dayWindow.lt },
      },
      orderBy: { recordedAt: "asc" },
      select: {
        id: true,
        recordedAt: true,
        lat: true,
        lng: true,
        speedKph: true,
        heading: true,
      },
    });

    const validPoints: ValidHistoryPoint[] = [];
    for (const row of rows) {
      const lat = decimalToNumber(row.lat);
      const lng = decimalToNumber(row.lng);
      if (lat === null || lng === null || !isValidCoordinate(lat, lng)) continue;
      validPoints.push({
        id: row.id,
        recordedAt: row.recordedAt,
        lat,
        lng,
        speedKph: row.speedKph ?? null,
        heading: row.heading ?? null,
      });
    }

    const stops = detectHistoryStops(validPoints, { stopMinutes, stopRadiusMeters });
    const summary = computeHistorySummary(validPoints, stops);
    const displayPoints = downsampleHistoryPoints(validPoints);

    return {
      chassisId: chassis.id,
      chassisNo: chassis.chassisNo,
      label: chassis.label ?? null,
      date: date.trim(),
      timezone,
      summary,
      stops: stops.map((stop) => ({
        id: stop.id,
        startedAt: stop.startedAt.toISOString(),
        endedAt: stop.endedAt.toISOString(),
        durationSeconds: stop.durationSeconds,
        lat: stop.lat,
        lng: stop.lng,
        pointCount: stop.pointCount,
        maxRadiusMeters: stop.maxRadiusMeters,
      })),
      points: displayPoints.map((p) => ({
        id: p.id,
        recordedAt: p.recordedAt.toISOString(),
        lat: p.lat,
        lng: p.lng,
        speedKph: p.speedKph,
        heading: p.heading,
      })),
    };
  }
}
