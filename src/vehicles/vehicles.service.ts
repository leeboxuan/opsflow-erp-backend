import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { VehicleStatus, VehicleType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import {
  parsePaginationFromQuery,
  buildPaginationMeta,
} from "../common/pagination";
import { applyMappedFilter } from "../common/listing/listing.filters";
import { buildOrderBy } from "../common/listing/listing.sort";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";
import {
  ListVehiclesQueryDto,
  VEHICLE_LIST_FILTER,
  VEHICLE_SORT_FIELDS,
} from "./dto/list-vehicles.query.dto";
import type { VehicleDto, ListVehiclesResult } from "./vehicles.types";

function toVehicleDto(v: any): VehicleDto {
  return {
    id: v.id,
    tenantId: v.tenantId,
    plateNo: v.plateNo,
    type: v.type,
    status: v.status,
    vehicleDescription: v.vehicleDescription,
    driverId: v.driverId,
    createdAt: v.createdAt,
    updatedAt: v.updatedAt,
  };
}

@Injectable()
export class VehiclesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Normalize plate: trim, collapse spaces, uppercase */
  normalizePlateNo(plateNo: string): string {
    return String(plateNo ?? "")
      .trim()
      .replace(/\s+/g, " ")
      .toUpperCase();
  }

  async create(tenantId: string, dto: CreateVehicleDto): Promise<VehicleDto> {
    const plateNo = this.normalizePlateNo(dto.plateNo);
    const existing = await this.prisma.vehicle.findUnique({
      where: {
        tenantId_plateNo: { tenantId, plateNo },
      },
    });
    if (existing) {
      throw new BadRequestException("Vehicle plate number already exists");
    }

    if (dto.driverId) {
      const user = await this.prisma.user.findFirst({
        where: { id: dto.driverId, tenantId },
      });
      if (!user) {
        throw new BadRequestException("Driver user not found");
      }
    }

    const vehicle = await this.prisma.vehicle.create({
      data: {
        tenantId,
        plateNo,
        type: dto.type,
        status: dto.status ?? VehicleStatus.ACTIVE,
        vehicleDescription: dto.vehicleDescription?.trim() || null,
        driverId: dto.driverId || null,
      },
    });
    return toVehicleDto(vehicle);
  }

  async list(
    tenantId: string,
    query: ListVehiclesQueryDto,
  ): Promise<ListVehiclesResult> {
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);

    const where: any = { tenantId };

    const filterMap: Record<string, any> = {
      [VEHICLE_LIST_FILTER.UNASSIGNED]: { driverId: null },
      [VEHICLE_LIST_FILTER.ASSIGNED]: {
        driverId: query.driverId ?? { not: null },
      },
    };
    applyMappedFilter(where, query.filter, filterMap);
    if (
      query.filter !== VEHICLE_LIST_FILTER.ASSIGNED &&
      query.filter !== VEHICLE_LIST_FILTER.UNASSIGNED &&
      query.driverId
    ) {
      where.driverId = query.driverId;
    }

    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;

    // q: search plateNo, type, or vehicleDescription (special handling for VehicleType enum)
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
      [...VEHICLE_SORT_FIELDS],
      { createdAt: "desc" },
    );

    const [total, data] = await this.prisma.$transaction([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        orderBy,
        skip,
        take,
      }),
    ]);

    return {
      data: data.map(toVehicleDto),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async getById(tenantId: string, id: string): Promise<VehicleDto> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    return toVehicleDto(vehicle);
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateVehicleDto,
  ): Promise<VehicleDto> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");

    const plateNo =
      dto.plateNo !== undefined
        ? this.normalizePlateNo(dto.plateNo)
        : undefined;
    if (plateNo !== undefined) {
      const existing = await this.prisma.vehicle.findFirst({
        where: {
          tenantId,
          plateNo,
          id: { not: id },
        },
      });
      if (existing) {
        throw new BadRequestException("Vehicle plate number already exists");
      }
    }

    if (dto.driverId !== undefined && dto.driverId !== null) {
      const user = await this.prisma.user.findFirst({
        where: { id: dto.driverId, tenantId },
      });
      if (!user) throw new BadRequestException("Driver user not found");
    }

    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: {
        ...(plateNo !== undefined && { plateNo }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.vehicleDescription !== undefined && {
          vehicleDescription: dto.vehicleDescription?.trim() || null,
        }),
        ...(dto.driverId !== undefined && { driverId: dto.driverId || null }),
      },
    });
    return toVehicleDto(updated);
  }

  async suspend(tenantId: string, id: string): Promise<VehicleDto> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: { status: VehicleStatus.INACTIVE },
    });
    return toVehicleDto(updated);
  }

  async unsuspend(tenantId: string, id: string): Promise<VehicleDto> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    const updated = await this.prisma.vehicle.update({
      where: { id },
      data: { status: VehicleStatus.ACTIVE },
    });
    return toVehicleDto(updated);
  }

  async delete(tenantId: string, id: string): Promise<{ id: string }> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    await this.prisma.vehicle.delete({ where: { id } });
    return { id };
  }


  async assignDriver(
    tenantId: string,
    vehicleId: string,
    driverId: string | null,
  ): Promise<VehicleDto> {
    return this.prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.findFirst({
        where: { id: vehicleId, tenantId },
      });
      if (!vehicle) throw new NotFoundException("Vehicle not found");
  
      // Unassign
      if (driverId === null) {
        const updated = await tx.vehicle.update({
          where: { id: vehicleId },
          data: { driverId: null },
        });
        return toVehicleDto(updated);
      }
  
      // Validate driver belongs to tenant (and optionally role)
      const driverUser = await tx.user.findFirst({
        where: { id: driverId, tenantId },
        select: { id: true },
      });
      if (!driverUser) {
        throw new BadRequestException("Driver user not found");
      }
  
      // OPTIONAL: enforce driver role here if you have it
      // if (driverUser.role !== "DRIVER") throw new BadRequestException("User is not a driver");
  
      // If this driver is assigned to another vehicle, unassign it first (1 driver -> 1 vehicle)
      const existingVehicleForDriver = await tx.vehicle.findFirst({
        where: { tenantId, driverId, id: { not: vehicleId } },
        select: { id: true },
      });
  
      if (existingVehicleForDriver) {
        await tx.vehicle.update({
          where: { id: existingVehicleForDriver.id },
          data: { driverId: null },
        });
      }
  
      // Assign to target vehicle
      const updated = await tx.vehicle.update({
        where: { id: vehicleId },
        data: { driverId },
      });
  
      return toVehicleDto(updated);
    });
  }
}
