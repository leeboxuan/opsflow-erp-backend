import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Request,
  NotFoundException,
  BadRequestException,
  Patch,
  Delete,
  Req,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import { RoleGuard } from "../shared/auth/guards/role.guard";
import { Roles } from "../shared/auth/guards/role.guard";
import { PrismaService } from "../shared/prisma/prisma.service";
import { LocationService } from "../transport/drivers/location/location.service";
import { Role, MembershipStatus } from "@prisma/client";
import { parsePaginationFromQuery, buildPaginationMeta } from "../shared/common/pagination";
import { applyMappedFilter } from "../shared/common/listing/listing.filters";
import { buildOrderBy } from "../shared/common/listing/listing.sort";
import { applyQSearch } from "../shared/common/listing/listing.search";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { VehicleDto } from "./dto/vehicle.dto";
import { DriverLocationDto } from "../transport/drivers/location/dto/location.dto";
import { SupabaseService } from "../shared/auth/supabase.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { toPersistedMembershipRole } from "../shared/auth/role-compat";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserDto } from "./dto/user.dto";
import { ResetUserPasswordDto } from "./dto/reset-user-password.dto";
import { AdminListQueryDto } from "./dto/list-query.dto";
import { listTenantUsers } from "./admin-users.list";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import {
  assertValidUsername,
  buildInternalAuthEmail,
  normalizeUsername,
  publicEmailOrNull,
} from "../shared/auth/auth-internal-email";
import {
  isUsernamePasswordOperationalUser,
  mapTenantMembershipToPublicUserDto,
} from "./admin-users.mapper";

@ApiTags("admin")
@Controller("admin")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF)
@ApiBearerAuth("JWT-auth")
export class AdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly locationService: LocationService,
    private readonly supabaseService: SupabaseService,
  ) {}


  @Get("users")
  @ApiOperation({ summary: "List all web users (Admin/Ops only)" })
  async getUsers(
    @Request() req: any,
    @Query() query: AdminListQueryDto,
  ): Promise<{ data: UserDto[]; meta: { page: number; pageSize: number; total: number } }> {
    return listTenantUsers(this.prisma, req.tenant.tenantId, query, {
      excludeDriver: true,
    });
  }

  @Post("users")
  @ApiOperation({ summary: "Create/invite a web user (Admin/Ops only)" })
  async createUser(@Request() req: any, @Body() dto: CreateUserDto): Promise<UserDto> {
    const tenantId = req.tenant.tenantId;

    if (dto.role === Role.DRIVER) {
      throw new BadRequestException("Use /admin/drivers to create drivers");
    }

    const persistedRole = toPersistedMembershipRole(dto.role);
    const usernameRaw = dto.username?.trim();
    const isUsernameUser = Boolean(usernameRaw);

    if (isUsernameUser && persistedRole !== Role.WAREHOUSE) {
      throw new BadRequestException(
        "Username login is only supported for warehouse mobile users",
      );
    }

    let normalizedUsername: string | null = null;
    let authEmail: string | null = null;

    if (isUsernameUser) {
      normalizedUsername = normalizeUsername(usernameRaw!);
      try {
        assertValidUsername(normalizedUsername);
      } catch (e: any) {
        throw new BadRequestException(e?.message || "Invalid username");
      }

      const existingInTenant = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId,
          user: { username: normalizedUsername },
        },
        select: { id: true },
      });
      if (existingInTenant) {
        throw new BadRequestException(
          "Username is already taken in this tenant",
        );
      }

      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { slug: true },
      });
      if (!tenant?.slug) {
        throw new BadRequestException("Tenant slug is required for username users");
      }

      authEmail = buildInternalAuthEmail(tenant.slug, normalizedUsername);

      if (!dto.password || dto.password.length < 8) {
        throw new BadRequestException(
          "Password (min 8 characters) is required for username-based users",
        );
      }
    } else {
      if (!dto.email?.trim()) {
        throw new BadRequestException("Email is required");
      }
      authEmail = dto.email.trim().toLowerCase();
    }

    const normalizeCompanyName = (name: string) =>
      String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

    const normalizeEmail = (email: string) =>
      String(email ?? "").trim().toLowerCase();

    let authUserId: string | null = null;

    if (isUsernameUser) {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase.auth.admin.createUser({
        email: authEmail!,
        password: dto.password!,
        email_confirm: true,
        user_metadata: {
          name: dto.name ?? undefined,
          tenantId,
          role: "WAREHOUSE",
          username: normalizedUsername,
        },
      });
      if (error) {
        const msg = String(error.message || "Failed to create auth user");
        throw new BadRequestException(
          msg.toLowerCase().includes("auth.opsflow.app")
            ? "Failed to create auth user"
            : msg,
        );
      }
      authUserId = data.user?.id ?? null;
      if (!authUserId) {
        throw new BadRequestException("Failed to create auth user");
      }
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: authEmail! },
        update: {
          name: dto.name ?? undefined,
          ...(dto.phone !== undefined && { phone: dto.phone }),
          ...(normalizedUsername && { username: normalizedUsername }),
          ...(authUserId && { authUserId }),
        },
        create: {
          email: authEmail!,
          name: dto.name ?? null,
          phone: dto.phone ?? null,
          username: normalizedUsername,
          authUserId,
        },
      });

      if (dto.role === Role.CUSTOMER) {
        const companyName = String(dto.customerCompanyName ?? "").trim();
        if (!companyName) {
          throw new BadRequestException("customerCompanyName is required for CUSTOMER users");
        }

        const contactName = String(dto.customerContactName ?? dto.name ?? "").trim() || "Customer";
        const contactEmail = normalizeEmail(dto.customerContactEmail ?? authEmail!);

        const company = await tx.customer_companies.upsert({
          where: {
            tenantId_normalizedName: {
              tenantId,
              normalizedName: normalizeCompanyName(companyName),
            },
          },
          update: {
            name: companyName,
          },
          create: {
            tenantId,
            name: companyName,
            normalizedName: normalizeCompanyName(companyName),
          },
          select: { id: true },
        });

        const contact = await tx.customer_contacts.upsert({
          where: {
            companyId_normalizedEmail: {
              companyId: company.id,
              normalizedEmail: contactEmail,
            },
          },
          update: {
            name: contactName,
            email: contactEmail,
          },
          create: {
            companyId: company.id,
            name: contactName,
            email: contactEmail,
            normalizedEmail: contactEmail,
          },
          select: { id: true },
        });

        await tx.user.update({
          where: { id: user.id },
          data: {
            customerCompanyId: company.id,
            customerContactId: contact.id,
          },
        });
      }

      const membership = await tx.tenantMembership.upsert({
        where: { tenantId_userId: { tenantId, userId: user.id } },
        update: {
          role: persistedRole,
          status:
            isUsernameUser || dto.sendInvite === false
              ? "Active"
              : "Invited",
        },
        create: {
          tenantId,
          userId: user.id,
          role: persistedRole,
          status:
            isUsernameUser || dto.sendInvite === false
              ? "Active"
              : "Invited",
        },
      });

      return { user, membership };
    });

    if (!isUsernameUser && dto.sendInvite !== false) {
      const supabase = this.supabaseService.getClient();
      const { error } = await supabase.auth.admin.inviteUserByEmail(authEmail!);
      if (error) {
        throw new BadRequestException(`Supabase invite failed: ${error.message}`);
      }
    } else if (
      !isUsernameUser &&
      dto.sendInvite === false &&
      dto.password &&
      dto.password.length >= 8
    ) {
      const supabase = this.supabaseService.getClient();
      const { data, error } = await supabase.auth.admin.createUser({
        email: authEmail!,
        password: dto.password,
        email_confirm: true,
        user_metadata: {
          name: dto.name ?? undefined,
          tenantId,
          role: String(persistedRole),
        },
      });
      if (error) {
        throw new BadRequestException(error.message);
      }
      if (data.user?.id) {
        await this.prisma.user.update({
          where: { id: result.user.id },
          data: { authUserId: data.user.id },
        });
      }
    }

    return mapTenantMembershipToPublicUserDto({
      id: result.membership.id,
      role: result.membership.role,
      status: result.membership.status,
      user: {
        id: result.user.id,
        email: result.user.email,
        username: result.user.username,
        name: result.user.name,
        phone: result.user.phone,
        createdAt: result.user.createdAt,
        updatedAt: result.user.updatedAt,
      },
    });
  }

  @Patch("users/:userId")
  @ApiOperation({ summary: "Update web user (Admin/Ops only)" })
  async updateUser(
    @Request() req: any,
    @Param("userId") userId: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDto> {
    const tenantId = req.tenant.tenantId;

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { user: true },
    });
    if (!membership)
      throw new NotFoundException("User not found in this tenant");

    if (dto.role === Role.DRIVER) {
      throw new BadRequestException("Drivers are managed under Drivers");
    }

    const persistedRole =
      dto.role !== undefined ? toPersistedMembershipRole(dto.role) : undefined;

    if (persistedRole !== undefined) {
      const currentIsOperational = isUsernamePasswordOperationalUser({
        role: membership.role,
        username: membership.user.username,
        email: membership.user.email,
      });
      const nextIsWarehouse = persistedRole === Role.WAREHOUSE;
      if (currentIsOperational !== nextIsWarehouse) {
        throw new BadRequestException(
          'Cannot change between username/password operational roles and email/invite office roles on the same user',
        );
      }
    }

    let nextUsername: string | undefined;
    if (dto.username !== undefined) {
      nextUsername = normalizeUsername(dto.username);
      try {
        assertValidUsername(nextUsername);
      } catch (e: any) {
        throw new BadRequestException(e?.message || "Invalid username");
      }
      const clash = await this.prisma.tenantMembership.findFirst({
        where: {
          tenantId,
          userId: { not: userId },
          user: { username: nextUsername },
        },
        select: { id: true },
      });
      if (clash) {
        throw new BadRequestException(
          "Username is already taken in this tenant",
        );
      }
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.phone !== undefined && { phone: dto.phone }),
        ...(nextUsername !== undefined && { username: nextUsername }),
      },
    });

    const updatedMembership = await this.prisma.tenantMembership.update({
      where: { id: membership.id },
      data: {
        ...(persistedRole !== undefined && { role: persistedRole }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    return mapTenantMembershipToPublicUserDto({
      id: updatedMembership.id,
      role: updatedMembership.role,
      status: updatedMembership.status,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        phone: user.phone,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
    });
  }

  @Post("users/:userId/reset-password")
  @ApiOperation({ summary: "Admin-controlled password reset for a tenant user" })
  async resetUserPassword(
    @Request() req: any,
    @Param("userId") userId: string,
    @Body() dto: ResetUserPasswordDto,
  ) {
    const tenantId = req.tenant.tenantId;
    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { user: true },
    });
    if (!membership) {
      throw new NotFoundException("User not found in this tenant");
    }

    if (
      !isUsernamePasswordOperationalUser({
        role: membership.role,
        username: membership.user.username,
        email: membership.user.email,
      })
    ) {
      throw new BadRequestException(
        "Password reset is only supported for username/password operational users",
      );
    }

    const authUserId = membership.user.authUserId;
    if (!authUserId) {
      throw new BadRequestException(
        "User has no auth account yet; create with a password or send an invite first",
      );
    }

    const supabase = this.supabaseService.getClient();
    const { error } = await supabase.auth.admin.updateUserById(authUserId, {
      password: dto.password,
    });
    if (error) {
      const msg = String(error.message || "Password reset failed");
      throw new BadRequestException(
        msg.toLowerCase().includes("auth.opsflow.app")
          ? "Password reset failed"
          : msg,
      );
    }

    return { ok: true };
  }

  @Delete("users/:userId")
  @ApiOperation({ summary: "Remove user from tenant (Admin/Ops only)" })
  async deleteUser(@Request() req: any, @Param("userId") userId: string) {
    const tenantId = req.tenant.tenantId;

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (!membership) throw new NotFoundException("User not found");

    // safer than deleting user globally
    await this.prisma.tenantMembership.delete({ where: { id: membership.id } });

    return { ok: true };
  }

  // @Post('drivers')
  // @ApiOperation({ summary: 'Create a new driver (Admin/Ops only)' })
  // async createDriver(
  //   @Request() req: any,
  //   @Body() dto: CreateDriverDto,
  // ): Promise<DriverDto> {
  //   const tenantId = req.tenant.tenantId;

  //   // Find or create user (User model has no phone in DB schema)
  //   const user = await this.prisma.user.upsert({
  //     where: { email: dto.email },
  //     update: {
  //       name: dto.name || undefined,
  //       phone: dto.phone || undefined, // ✅ ADD

  //     },
  //     create: {
  //       email: dto.email,
  //       name: dto.name || null,
  //       phone: dto.phone || null, // ✅ ADD

  //     },
  //   });

  //   // Check if membership already exists
  //   const existingMembership = await this.prisma.tenantMembership.findUnique({
  //     where: {
  //       tenantId_userId: {
  //         tenantId,
  //         userId: user.id,
  //       },
  //     },
  //   });

  //   if (existingMembership) {
  //     // Update existing membership to Driver role if not already
  //     const membership =
  //       existingMembership.role === Role.DRIVER
  //         ? existingMembership
  //         : await this.prisma.tenantMembership.update({
  //           where: { id: existingMembership.id },
  //           data: { role: Role.DRIVER },
  //         });

  //     return {
  //       id: user.id,
  //       email: user.email,
  //       name: user.name,
  //       phone: (user as { phone?: string | null }).phone ?? dto.phone ?? null,
  //       role: membership.role,
  //       membershipId: membership.id,
  //       createdAt: user.createdAt,
  //       updatedAt: user.updatedAt,
  //     };
  //   }

  //   // Create new membership with Driver role
  //   const membership = await this.prisma.tenantMembership.create({
  //     data: {
  //       tenantId,
  //       userId: user.id,
  //       role: Role.DRIVER,
  //       status: MembershipStatus.Active,
  //     },
  //   });

  //   const supabase = this.supabaseService.getClient();
  //   await supabase.auth.admin.inviteUserByEmail(dto.email);

  //   return {
  //     id: user.id,
  //     email: user.email,
  //     name: user.name,
  //     phone: dto.phone ?? null,
  //     role: membership.role,
  //     membershipId: membership.id,
  //     createdAt: user.createdAt,
  //     updatedAt: user.updatedAt,
  //   };
  // }

  @Get("vehicles")
  @ApiOperation({ summary: "List all vehicles (Admin/Ops only)" })
  async getVehicles(
    @Request() req: any,
    @Query() query: AdminListQueryDto,
  ): Promise<{ data: VehicleDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const tenantId = req.tenant.tenantId;
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);

    const where: any = { tenantId };
    applyQSearch(where, query.q?.trim(), ["plateNo", "vehicleDescription"]);

    const orderBy = buildOrderBy(
      query.sortBy,
      query.sortDir,
      ["plateNo", "createdAt", "updatedAt", "type", "status"],
      { plateNo: "asc" },
    );

    const [total, vehicles] = await this.prisma.$transaction([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        orderBy,
        skip,
        take,
      }),
    ]);

    const data = vehicles.map(
      (vehicle): VehicleDto => ({
        id: vehicle.id,
        plateNo: vehicle.plateNo,
        type: vehicle.type,
        status: vehicle.status,
        vehicleDescription: vehicle.vehicleDescription,
        driverId: vehicle.driverId,
        createdAt: vehicle.createdAt,
        updatedAt: vehicle.updatedAt,
      }),
    );

    return { data, meta: buildPaginationMeta(page, pageSize, total) };
  }

  @Post("vehicles")
  @ApiOperation({ summary: "Create a new vehicle (Admin/Ops only)" })
  async createVehicle(
    @Request() req: any,
    @Body() dto: CreateVehicleDto,
  ): Promise<VehicleDto> {
    const tenantId = req.tenant.tenantId;
    const plateNo = dto.plateNo.trim().replace(/\s+/g, " ").toUpperCase();

    const existing = await this.prisma.vehicle.findUnique({
      where: {
        tenantId_plateNo: { tenantId, plateNo },
      },
    });

    if (existing) {
      throw new BadRequestException(
        "Vehicle plate number already exists",
      );
    }

    const vehicle = await this.prisma.vehicle.create({
      data: {
        tenantId,
        plateNo,
        type: dto.type,
        status: dto.status ?? ("ACTIVE" as const),
        vehicleDescription: dto.vehicleDescription || null,
        driverId: dto.driverId || null,
      },
    });

    return {
      id: vehicle.id,
      plateNo: vehicle.plateNo,
      type: vehicle.type,
      status: vehicle.status,
      vehicleDescription: vehicle.vehicleDescription,
      driverId: vehicle.driverId,
      createdAt: vehicle.createdAt,
      updatedAt: vehicle.updatedAt,
    };
  }

  @Get("locations")
  @ApiOperation({ summary: "Get all driver locations (Admin/Ops only)" })
  async getLocations(
    @Request() req: any,
    @Query() query: AdminListQueryDto,
  ): Promise<{ data: DriverLocationDto[]; meta: { page: number; pageSize: number; total: number } }> {
    const tenantId = req.tenant.tenantId;
    return this.locationService.getAllDriverLocations(tenantId, query);
  }


 

  // 1) resend invite
  // @Post("users/:userId/resend-invite")
  // async resendInvite(@Request() req: any, @Param("userId") userId: string) {
  //   const tenantId = req.tenant.tenantId;

  //   const membership = await this.prisma.tenantMembership.findUnique({
  //     where: { tenantId_userId: { tenantId, userId } },
  //     include: { user: true },
  //   });
  //   if (!membership) throw new NotFoundException("User not found in this tenant");

  //   if (membership.role === Role.DRIVER) {
  //     throw new BadRequestException("Drivers are managed under Drivers");
  //   }

  //   const supabase = this.supabaseService.getClient();
  //   const { error } = await supabase.auth.admin.inviteUserByEmail(membership.user.email);
  //   if (error) throw new BadRequestException(`Supabase invite failed: ${error.message}`);

  //   await this.prisma.tenantMembership.update({
  //     where: { id: membership.id },
  //     data: { status: "Invited" },
  //   });

  //   return { ok: true };
  // }

  // 2) sync status (confirmed => Active)
  @Post("users/:userId/sync-status")
  async syncUserStatus(@Request() req: any, @Param("userId") userId: string) {
    const tenantId = req.tenant.tenantId;

    const membership = await this.prisma.tenantMembership.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      include: { user: true },
    });
    if (!membership)
      throw new NotFoundException("User not found in this tenant");

    const email = membership.user.email;
    const supabase = this.supabaseService.getClient();

    // Supabase Admin API doesn't give us a direct "getByEmail" in the simple way.
    // For small teams, we can page through users until we find a matching email.
    // Keep it capped so it can't run forever.
    let confirmed = false;

    const PER_PAGE = 100;
    const MAX_PAGES = 10; // up to 1000 users
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await supabase.auth.admin.listUsers({
        page,
        perPage: PER_PAGE,
      });

      if (error)
        throw new BadRequestException(
          `Supabase list users failed: ${error.message}`,
        );
      const users = (data?.users ?? []) as SupabaseAuthUser[];

      const found = users.find(
        (u) => (u.email ?? "").toLowerCase() === email.toLowerCase(),
      );

      if (found) {
        // Supabase fields vary by version; these are the typical ones:
        const emailConfirmedAt: any =
          (found as any).email_confirmed_at ??
          (found as any).confirmed_at ??
          (found as any).user_metadata?.email_confirmed_at;

        confirmed = !!emailConfirmedAt;
        break;
      }

      // no more results
      if (data.users.length < PER_PAGE) break;
    }

    const nextStatus: MembershipStatus = confirmed ? "Active" : "Invited";

    const updated = await this.prisma.tenantMembership.update({
      where: { id: membership.id },
      data: { status: nextStatus },
    });

    return { ok: true, status: updated.status };
  }


}
