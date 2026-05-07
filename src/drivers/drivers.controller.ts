import {
  BadRequestException,
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Request,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/guards/role.guard';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { UpdateDriverDto } from './dto/update-driver.dto';
import { UsersService } from '../users/users.service';

export interface DriverDto {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  displayName?: string | null;
  userName?: string | null;
  userEmail?: string | null;
  role: Role;
  avatarUrl?: string | null;
  avatarUpdatedAt?: Date | null;
  defaultVehicleId?: string | null;
  defaultFleetVehicleId?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@ApiTags('drivers')
@Controller('drivers')
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth('JWT-auth')
export class DriversController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
  ) {}

  @Get('me')
  @ApiOperation({ summary: 'Get current user driver profile' })
  async getDriverMe(@Request() req: any): Promise<DriverDto> {
    const userId = req.user.userId;
    const tenantId = req.tenant.tenantId;

    // Get user with membership in current tenant
    const membership = await this.prisma.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
      include: {
        user: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Driver profile not found');
    }

    const profile = await this.prisma.drivers.findFirst({
      where: { tenantId, userId },
      select: {
        name: true,
        assignedVehicleId: true,
        assignedFleetVehicleId: true,
      },
    });

    return {
      userId: membership.user.id,
      id: membership.user.id,
      email: membership.user.email,
      name:
        (profile as any)?.name ??
        (membership.user as any).displayName ??
        membership.user.name ??
        membership.user.email,
      displayName:
        (membership.user as any).displayName ??
        membership.user.name ??
        membership.user.email,
      userName: membership.user.name ?? null,
      userEmail: membership.user.email ?? null,
      role: membership.role,
      avatarUrl: await this.usersService.getUserAvatarSignedUrl(
        (membership.user as any).avatarKey ?? null,
      ),
      avatarUpdatedAt: (membership.user as any).avatarUpdatedAt ?? null,
      defaultVehicleId: profile?.assignedVehicleId ?? null,
      defaultFleetVehicleId: profile?.assignedFleetVehicleId ?? null,
      createdAt: membership.user.createdAt,
      updatedAt: membership.user.updatedAt,
    };
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update current user driver profile' })
  async updateDriverMe(
    @Request() req: any,
    @Body() dto: UpdateDriverDto,
  ): Promise<DriverDto> {
    if (dto.name !== undefined) {
      throw new BadRequestException(
        "Drivers cannot update name or email from profile.",
      );
    }
    const userId = req.user.userId;
    const tenantId = req.tenant.tenantId;

    // Update user
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
      },
    });

    // Get updated membership
    const membership = await this.prisma.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId,
        },
      },
    });

    if (!membership) {
      throw new NotFoundException('Driver profile not found');
    }

    const profile = await this.prisma.drivers.findFirst({
      where: { tenantId, userId },
      select: {
        name: true,
        assignedVehicleId: true,
        assignedFleetVehicleId: true,
      },
    });

    return {
      userId: user.id,
      id: user.id,
      email: user.email,
      name:
        (profile as any)?.name ??
        (user as any).displayName ??
        user.name ??
        user.email,
      displayName:
        (user as any).displayName ??
        user.name ??
        user.email,
      userName: user.name ?? null,
      userEmail: user.email ?? null,
      role: membership.role,
      avatarUrl: await this.usersService.getUserAvatarSignedUrl(
        (user as any).avatarKey ?? null,
      ),
      avatarUpdatedAt: (user as any).avatarUpdatedAt ?? null,
      defaultVehicleId: profile?.assignedVehicleId ?? null,
      defaultFleetVehicleId: profile?.assignedFleetVehicleId ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
