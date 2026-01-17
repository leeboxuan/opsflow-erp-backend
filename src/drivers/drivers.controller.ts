import {
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

export interface DriverDto {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  createdAt: Date;
  updatedAt: Date;
}

@ApiTags('drivers')
@Controller('drivers')
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth('JWT-auth')
export class DriversController {
  constructor(private readonly prisma: PrismaService) {}

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

    return {
      id: membership.user.id,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role,
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

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: membership.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
