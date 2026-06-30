import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { VehicleStatus, VehicleType } from "@prisma/client";
import { applyMappedFilter } from "../../../shared/common/listing/listing.filters";
import { buildOrderBy } from "../../../shared/common/listing/listing.sort";
import {
  buildPaginationMeta,
  parsePaginationFromQuery,
} from "../../../shared/common/pagination";
import { PrismaService } from "../../../shared/prisma/prisma.service";
import { AssignFleetVehicleDriverDto } from "./dto/assign-fleet-vehicle-driver.dto";
import { CreateFleetVehicleDto } from "./dto/create-fleet-vehicle.dto";
import {
  FLEET_VEHICLE_LIST_FILTER,
  FLEET_VEHICLE_SORT_FIELDS,
  ListFleetVehiclesQueryDto,
} from "./dto/list-fleet-vehicles.query.dto";
import { UpdateFleetVehicleDto } from "./dto/update-fleet-vehicle.dto";
import type {
  FleetVehicleDto,
  ListFleetVehiclesResult,
} from "./fleet-vehicles.types";

function toFleetVehicleDto(v: any): FleetVehicleDto {
  return {
    id: v.id,
    tenantId: v.tenantId,
    plateNo: v.plateNo,
    type: v.type,
    status: v.status,
    vehicleDescription: v.vehicleDescription,
    driverId: v.driverId,
    driver: v.driver
      ? { id: v.driver.id, name: v.driver.name ?? null, email: v.driver.email ?? null }
      : null,
    roadTaxExpiryDate: v.roadTaxExpiryDate ?? null,
    lastServicingDate: v.lastServicingDate ?? null,
    coeExpiryDate: v.coeExpiryDate ?? null,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

@Injectable()
export class FleetVehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  normalizePlateNo(plateNo: string): string {
    return String(plateNo ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
  }

  async create(tenantId: string, dto: CreateFleetVehicleDto): Promise<FleetVehicleDto> {
    const plateNo = this.normalizePlateNo(dto.plateNo);
    const existing = await this.prisma.fleetVehicle.findUnique({
      where: {
        tenantId_plateNo: { tenantId, plateNo },
      },
    });
    if (existing) {
      throw new BadRequestException("Fleet vehicle plate number already exists");
    }

    if (dto.driverId) {
      const user = await this.prisma.user.findFirst({
        where: { id: dto.driverId, tenantId },
      });
      if (!user) throw new BadRequestException("Driver user not found");
    }

    const vehicle = await this.prisma.fleetVehicle.create({
      data: {
        tenantId,
        plateNo,
        type: dto.type,
        status: dto.status ?? VehicleStatus.ACTIVE,
        vehicleDescription: dto.vehicleDescription?.trim() || null,
        driverId: dto.driverId || null,
        roadTaxExpiryDate: dto.roadTaxExpiryDate
          ? new Date(dto.roadTaxExpiryDate)
          : null,
        lastServicingDate: dto.lastServicingDate
          ? new Date(dto.lastServicingDate)
          : null,
        coeExpiryDate: dto.coeExpiryDate ? new Date(dto.coeExpiryDate) : null,
      },
    });
    return toFleetVehicleDto(vehicle);
  }

  async list(
    tenantId: string,
    query: ListFleetVehiclesQueryDto,
  ): Promise<ListFleetVehiclesResult> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);

    const where: any = { tenantId };
    const filterMap: Record<string, any> = {
      [FLEET_VEHICLE_LIST_FILTER.UNASSIGNED]: { driverId: null },
      [FLEET_VEHICLE_LIST_FILTER.ASSIGNED]: {
        driverId: query.driverId ?? { not: null },
      },
    };
    applyMappedFilter(where, query.filter, filterMap);
    if (
      query.filter !== FLEET_VEHICLE_LIST_FILTER.ASSIGNED &&
      query.filter !== FLEET_VEHICLE_LIST_FILTER.UNASSIGNED &&
      query.driverId
    ) {
      where.driverId = query.driverId;
    }

    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;

    const q = query.q?.trim();
    if (q) {
      const orConditions: any[] = [
        { plateNo: { contains: q, mode: "insensitive" } },
        { vehicleDescription: { contains: q, mode: "insensitive" } },
      ];
      const qUpper = q.toUpperCase().replace(/-/g, "_");
      const matchingType = Object.values(VehicleType).find(
        (t) =>
          t === qUpper ||
          t.replace(/_/g, " ").toLowerCase() === q.toLowerCase(),
      );
      if (matchingType) orConditions.push({ type: matchingType });
      where.AND = where.AND || [];
      where.AND.push({ OR: orConditions });
    }

    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortDir === "asc" ? "asc" : "desc",
      [...FLEET_VEHICLE_SORT_FIELDS],
      { createdAt: "desc" },
    );

    const [total, data] = await this.prisma.$transaction([
      this.prisma.fleetVehicle.count({ where }),
      this.prisma.fleetVehicle.findMany({
        where,
        orderBy,
        skip,
        take,
        include: {
          driver: { select: { id: true, name: true, email: true } },
        },
      }),
    ]);

    return {
      data: data.map(toFleetVehicleDto),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getById(tenantId: string, id: string): Promise<FleetVehicleDto> {
    const vehicle = await this.prisma.fleetVehicle.findFirst({
      where: { id, tenantId },
      include: {
        driver: { select: { id: true, name: true, email: true } },
      },
    });
    if (!vehicle) throw new NotFoundException("Fleet vehicle not found");
    return toFleetVehicleDto(vehicle);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateFleetVehicleDto,
  ): Promise<FleetVehicleDto> {
    const vehicle = await this.prisma.fleetVehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Fleet vehicle not found");

    const plateNo =
      dto.plateNo !== undefined
        ? this.normalizePlateNo(dto.plateNo)
        : undefined;
    if (plateNo !== undefined) {
      const existing = await this.prisma.fleetVehicle.findFirst({
        where: {
          tenantId,
          plateNo,
          id: { not: id },
        },
      });
      if (existing) {
        throw new BadRequestException("Fleet vehicle plate number already exists");
      }
    }

    if (dto.driverId !== undefined && dto.driverId !== null) {
      const user = await this.prisma.user.findFirst({
        where: { id: dto.driverId, tenantId },
      });
      if (!user) throw new BadRequestException("Driver user not found");
    }

    const updated = await this.prisma.fleetVehicle.update({
      where: { id },
      data: {
        ...(plateNo !== undefined && { plateNo }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.vehicleDescription !== undefined && {
          vehicleDescription: dto.vehicleDescription?.trim() || null,
        }),
        ...(dto.driverId !== undefined && { driverId: dto.driverId || null }),
        ...(dto.roadTaxExpiryDate !== undefined && {
          roadTaxExpiryDate: dto.roadTaxExpiryDate
            ? new Date(dto.roadTaxExpiryDate)
            : null,
        }),
        ...(dto.lastServicingDate !== undefined && {
          lastServicingDate: dto.lastServicingDate
            ? new Date(dto.lastServicingDate)
            : null,
        }),
        ...(dto.coeExpiryDate !== undefined && {
          coeExpiryDate: dto.coeExpiryDate ? new Date(dto.coeExpiryDate) : null,
        }),
      },
    });
    return toFleetVehicleDto(updated);
  }

  async delete(tenantId: string, id: string): Promise<{ id: string }> {
    const vehicle = await this.prisma.fleetVehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Fleet vehicle not found");
    await this.prisma.fleetVehicle.delete({ where: { id } });
    return { id };
  }

  async suspend(tenantId: string, id: string): Promise<FleetVehicleDto> {
    const vehicle = await this.prisma.fleetVehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Fleet vehicle not found");
    const updated = await this.prisma.fleetVehicle.update({
      where: { id },
      data: { status: VehicleStatus.INACTIVE },
    });
    return toFleetVehicleDto(updated);
  }

  async unsuspend(tenantId: string, id: string): Promise<FleetVehicleDto> {
    const vehicle = await this.prisma.fleetVehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Fleet vehicle not found");
    const updated = await this.prisma.fleetVehicle.update({
      where: { id },
      data: { status: VehicleStatus.ACTIVE },
    });
    return toFleetVehicleDto(updated);
  }

  async assignDriver(
    tenantId: string,
    fleetVehicleId: string,
    dto: AssignFleetVehicleDriverDto,
  ): Promise<FleetVehicleDto> {
    const vehicle = await this.prisma.fleetVehicle.findFirst({
      where: { id: fleetVehicleId, tenantId },
      select: { id: true, driverId: true },
    });
    if (!vehicle) throw new NotFoundException("Fleet vehicle not found");

    const driverId = dto.driverId ?? null;
    if (!driverId) {
      const updated = await this.prisma.$transaction(async (tx) => {
        const v = await tx.fleetVehicle.update({
          where: { id: fleetVehicleId },
          data: { driverId: null },
        });
        await tx.drivers.updateMany({
          where: { tenantId, assignedFleetVehicleId: fleetVehicleId },
          data: { assignedFleetVehicleId: null },
        });
        return v;
      });
      return toFleetVehicleDto(updated);
    }

    const driver = await this.prisma.user.findFirst({
      where: {
        id: driverId,
        memberships: { some: { tenantId } },
      },
      select: { id: true },
    });
    if (!driver) throw new BadRequestException("Driver not found in this tenant");

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.fleetVehicle.updateMany({
        where: { tenantId, driverId },
        data: { driverId: null },
      });

      await tx.vehicle.updateMany({
        where: { tenantId, driverId },
        data: { driverId: null },
      });

      await tx.drivers.updateMany({
        where: { tenantId, userId: driverId },
        data: { assignedVehicleId: null },
      });

      const v = await tx.fleetVehicle.update({
        where: { id: fleetVehicleId },
        data: { driverId },
      });

      await tx.drivers.updateMany({
        where: { tenantId, userId: driverId },
        data: { assignedFleetVehicleId: fleetVehicleId },
      });

      return v;
    });

    return toFleetVehicleDto(updated);
  }
}
