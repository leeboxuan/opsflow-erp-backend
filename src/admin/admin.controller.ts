import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  Request,
  NotFoundException,
  BadRequestException,
  Patch,
  Delete,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/guards/role.guard';
import { PrismaService } from '../prisma/prisma.service';
import { LocationService } from '../driver/location.service';
import { Role, MembershipStatus } from '@prisma/client';
import { CreateDriverDto } from './dto/create-driver.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { DriverDto } from './dto/driver.dto';
import { VehicleDto } from './dto/vehicle.dto';
import { DriverLocationDto } from '../driver/dto/location.dto';
import { UpdateDriverDto } from "../drivers/dto/update-driver.dto"; // reuse

@ApiTags('admin')
@Controller('admin')
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.Admin, Role.Ops)
@ApiBearerAuth('JWT-auth')
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locationService: LocationService,
  ) { }

  @Get('drivers')
  @ApiOperation({ summary: 'List all drivers (Admin/Ops only)' })
  async getDrivers(@Request() req: any): Promise<DriverDto[]> {
    const tenantId = req.tenant.tenantId;

    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
        role: Role.Driver,
        status: MembershipStatus.Active,
      },
      include: {
        user: true,
      },
      orderBy: {
        user: {
          name: 'asc',
        },
      },
    });

    return memberships.map(
      (membership): DriverDto => ({
        id: membership.user.id,
        email: membership.user.email,
        name: membership.user.name,
        phone: (membership.user as { phone?: string | null }).phone ?? null,
        role: membership.role,
        membershipId: membership.id,
        createdAt: membership.user.createdAt,
        updatedAt: membership.user.updatedAt,
      }),
    );
  }

  @Post('drivers')
  @ApiOperation({ summary: 'Create a new driver (Admin/Ops only)' })
  async createDriver(
    @Request() req: any,
    @Body() dto: CreateDriverDto,
  ): Promise<DriverDto> {
    const tenantId = req.tenant.tenantId;

    // Find or create user (User model has no phone in DB schema)
    const user = await this.prisma.user.upsert({
      where: { email: dto.email },
      update: {
        name: dto.name || undefined,
        phone: dto.phone || undefined, // ✅ ADD

      },
      create: {
        email: dto.email,
        name: dto.name || null,
        phone: dto.phone || null, // ✅ ADD

      },
    });

    // Check if membership already exists
    const existingMembership = await this.prisma.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId: user.id,
        },
      },
    });

    if (existingMembership) {
      // Update existing membership to Driver role if not already
      const membership =
        existingMembership.role === Role.Driver
          ? existingMembership
          : await this.prisma.tenantMembership.update({
            where: { id: existingMembership.id },
            data: { role: Role.Driver },
          });

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        phone: (user as { phone?: string | null }).phone ?? dto.phone ?? null,
        role: membership.role,
        membershipId: membership.id,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
    }

    // Create new membership with Driver role
    const membership = await this.prisma.tenantMembership.create({
      data: {
        tenantId,
        userId: user.id,
        role: Role.Driver,
        status: MembershipStatus.Active,
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: dto.phone ?? null,
      role: membership.role,
      membershipId: membership.id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @Get('vehicles')
  @ApiOperation({ summary: 'List all vehicles (Admin/Ops only)' })
  async getVehicles(@Request() req: any): Promise<VehicleDto[]> {
    const tenantId = req.tenant.tenantId;

    const vehicles = await this.prisma.vehicle.findMany({
      where: { tenantId },
      orderBy: {
        vehicleNumber: 'asc',
      },
    });

    return vehicles.map(
      (vehicle): VehicleDto => ({
        id: vehicle.id,
        vehicleNumber: vehicle.vehicleNumber,
        type: (vehicle as { type?: string | null }).type ?? null,
        notes: vehicle.notes,
        createdAt: vehicle.createdAt,
        updatedAt: vehicle.updatedAt,
      }),
    );
  }

  @Post('vehicles')
  @ApiOperation({ summary: 'Create a new vehicle (Admin/Ops only)' })
  async createVehicle(
    @Request() req: any,
    @Body() dto: CreateVehicleDto,
  ): Promise<VehicleDto> {
    const tenantId = req.tenant.tenantId;

    // Check if vehicle number already exists for this tenant
    const existing = await this.prisma.vehicle.findUnique({
      where: {
        tenantId_vehicleNumber: {
          tenantId,
          vehicleNumber: dto.vehicleNumber,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'Vehicle with this number already exists for this tenant',
      );
    }

    const vehicle = await this.prisma.vehicle.create({
      data: {
        tenantId,
        vehicleNumber: dto.vehicleNumber,
        notes: dto.notes || null,
      },
    });

    return {
      id: vehicle.id,
      vehicleNumber: vehicle.vehicleNumber,
      type: dto.type ?? null,
      notes: vehicle.notes,
      createdAt: vehicle.createdAt,
      updatedAt: vehicle.updatedAt,
    };
  }

  @Get('locations')
  @ApiOperation({ summary: 'Get all driver locations (Admin/Ops only)' })
  async getLocations(@Request() req: any): Promise<DriverLocationDto[]> {
    const tenantId = req.tenant.tenantId;
    return this.locationService.getAllDriverLocations(tenantId);
  }

  @Patch("drivers/:driverId")
  @ApiOperation({ summary: "Update driver (Admin/Ops only)" })
  async updateDriver(
    @Request() req: any,
    @Param("driverId") driverId: string,
    @Body() dto: UpdateDriverDto & { phone?: string },
  ): Promise<DriverDto> {
    const tenantId = req.tenant.tenantId;

    // ensure user is a driver in this tenant
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: driverId } },
      include: { user: true },
    });

    if (!membership) throw new NotFoundException("Driver not found");

    const user = await this.prisma.user.update({
      where: { id: driverId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        // normally don't allow email change
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: (user as any).phone ?? null,
      role: membership.role,
      membershipId: membership.id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  @Delete("drivers/:driverId")
  async deleteDriver(
    @Req() req,
    @Param("driverId") driverId: string,
  ) {
    const tenantId = req.tenant.tenantId;

    // ensure driver belongs to this tenant
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId: driverId } },
    });
    if (!membership) throw new NotFoundException("Driver not found");

    // block delete if active trip
    const activeTrip = await this.prisma.trip.findFirst({
      where: {
        tenantId,
        assignedDriverId: driverId,
        status: { in: ["Planned", "Dispatched", "InTransit"] },
      },
    });
    if (activeTrip) {
      throw new BadRequestException("Driver has active trip");
    }

    await this.prisma.$transaction([
      this.prisma.driverLocation.deleteMany({
        where: { tenantId, driverUserId: driverId },
      }),
      this.prisma.tenantMembership.delete({
        where: { tenantId_userId: { tenantId, userId: driverId } },
      }),
    ]);

    return { ok: true };
  }

}
