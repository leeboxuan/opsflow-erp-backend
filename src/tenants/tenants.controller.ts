import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from '../auth/guards/auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { RoleGuard } from '../auth/guards/role.guard';
import { Roles } from '../auth/guards/role.guard';
import { PrismaService } from '../prisma/prisma.service';
import { MembershipStatus, Role } from '@prisma/client';
import { InviteMemberDto } from './dto/invite-member.dto';
import { UpdateMembershipDto } from './dto/update-membership.dto';

export interface TenantDto {
  id: string;
  name: string;
  slug: string;
  role: Role;
  createdAt: Date;
}

export interface MemberDto {
  id: string;
  userId: string;
  email: string;
  name: string | null;
  role: Role;
  status: MembershipStatus;
  createdAt: Date;
  updatedAt: Date;
}

@ApiTags('tenants')
@Controller('tenants')
export class TenantsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @UseGuards(AuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get all tenants for current user' })
  async getTenants(@Request() req: any): Promise<TenantDto[]> {
    const user = req.user;

    // Use userId from req.user (set by AuthGuard)
    if (!user || !user.userId) {
      return [];
    }

    // Get all tenants where user has active membership
    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        userId: user.userId,
        status: MembershipStatus.Active,
      },
      include: {
        tenant: true,
      },
      orderBy: {
        tenant: {
          name: 'asc',
        },
      },
    });

    // Map Prisma results to DTO shape
    return memberships.map(
      (membership): TenantDto => ({
        id: membership.tenant.id,
        name: membership.tenant.name,
        slug: membership.tenant.slug,
        role: membership.role,
        createdAt: membership.tenant.createdAt,
      }),
    );
  }

  @Get('me')
  @UseGuards(AuthGuard, TenantGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get current tenant information' })
  async getCurrentTenant(@Request() req: any) {
    const tenantId = req.tenant.tenantId;
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      role: req.tenant.role,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
    };
  }

  @Get('members')
  @UseGuards(AuthGuard, TenantGuard, RoleGuard)
  @Roles(Role.Admin, Role.Ops)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'List all members of current tenant (Admin/Ops only)' })
  async getMembers(@Request() req: any): Promise<MemberDto[]> {
    const tenantId = req.tenant.tenantId;

    const memberships = await this.prisma.tenantMembership.findMany({
      where: {
        tenantId,
      },
      include: {
        user: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return memberships.map(
      (membership): MemberDto => ({
        id: membership.id,
        userId: membership.userId,
        email: membership.user.email,
        name: membership.user.name,
        role: membership.role,
        status: membership.status,
        createdAt: membership.createdAt,
        updatedAt: membership.updatedAt,
      }),
    );
  }

  @Post('invite')
  @UseGuards(AuthGuard, TenantGuard, RoleGuard)
  @Roles(Role.Admin)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Invite a user to join the tenant (Admin only)' })
  async inviteMember(
    @Request() req: any,
    @Body() dto: InviteMemberDto,
  ): Promise<MemberDto> {
    const tenantId = req.tenant.tenantId;

    // Find or create user by email
    const user = await this.prisma.user.upsert({
      where: { email: dto.email },
      update: {},
      create: {
        email: dto.email,
        name: dto.name || null,
      },
    });

    // Check if membership already exists
    const existing = await this.prisma.tenantMembership.findUnique({
      where: {
        tenantId_userId: {
          tenantId,
          userId: user.id,
        },
      },
    });

    if (existing) {
      throw new BadRequestException(
        'User is already a member of this tenant',
      );
    }

    // Create membership
    const membership = await this.prisma.tenantMembership.create({
      data: {
        tenantId,
        userId: user.id,
        role: dto.role,
        status: MembershipStatus.Invited,
      },
      include: {
        user: true,
      },
    });

    return {
      id: membership.id,
      userId: membership.userId,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role,
      status: membership.status,
      createdAt: membership.createdAt,
      updatedAt: membership.updatedAt,
    };
  }

  @Patch('members/:membershipId')
  @UseGuards(AuthGuard, TenantGuard, RoleGuard)
  @Roles(Role.Admin)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Update membership status or role (Admin only)' })
  async updateMembership(
    @Request() req: any,
    @Param('membershipId') membershipId: string,
    @Body() dto: UpdateMembershipDto,
  ): Promise<MemberDto> {
    const tenantId = req.tenant.tenantId;

    // Verify membership belongs to current tenant
    const membership = await this.prisma.tenantMembership.findFirst({
      where: {
        id: membershipId,
        tenantId,
      },
      include: {
        user: true,
      },
    });

    if (!membership) {
      throw new NotFoundException('Membership not found');
    }

    // Update membership
    const updated = await this.prisma.tenantMembership.update({
      where: { id: membershipId },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
      include: {
        user: true,
      },
    });

    return {
      id: updated.id,
      userId: updated.userId,
      email: updated.user.email,
      name: updated.user.name,
      role: updated.role,
      status: updated.status,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}
