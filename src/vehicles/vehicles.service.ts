import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from "@nestjs/common";
import { VehicleStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { UpdateVehicleDto } from "./dto/update-vehicle.dto";
import { ListVehiclesQueryDto } from "./dto/list-vehicles.query.dto";
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
        where: { id: dto.driverId },
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
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const skip = (page - 1) * pageSize;

    const where: any = { tenantId };
    if (query.q?.trim()) {
      where.plateNo = { contains: query.q.trim(), mode: "insensitive" };
    }
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.driverId) where.driverId = query.driverId;

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data: data.map(toVehicleDto),
      meta: { page, pageSize, total },
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
      dto.plateNo !== undefined ? this.normalizePlateNo(dto.plateNo) : undefined;
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
        where: { id: dto.driverId },
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

  async delete(tenantId: string, id: string): Promise<void> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenantId },
    });
    if (!vehicle) throw new NotFoundException("Vehicle not found");
    await this.prisma.vehicle.delete({ where: { id } });
  }
}
