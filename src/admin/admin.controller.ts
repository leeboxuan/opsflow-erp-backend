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
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RoleGuard } from "../auth/guards/role.guard";
import { Roles } from "../auth/guards/role.guard";
import { PrismaService } from "../prisma/prisma.service";
import { LocationService } from "../driver/location.service";
import { Role, MembershipStatus } from "@prisma/client";
import { parsePaginationFromQuery, buildPaginationMeta } from "../common/pagination";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { VehicleDto } from "./dto/vehicle.dto";
import { DriverLocationDto } from "../driver/dto/location.dto";
import { SupabaseService } from "../auth/supabase.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserDto } from "./dto/user.dto";
import { AdminListQueryDto } from "./dto/list-query.dto";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";

@ApiTags("admin")
@Controller("admin")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS)
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
    const tenantId = req.tenant.tenantId;
    const { page, pageSize, skip, take } = parsePaginationFromQuery(query);

    const where = {
      tenantId,
      NOT: { role: Role.DRIVER },
    };

    const [total, memberships] = await this.prisma.$transaction([
      this.prisma.tenantMembership.count({ where }),
      this.prisma.tenantMembership.findMany({
        where,
        include: { user: true },
        orderBy: { user: { createdAt: "desc" } },
        skip,
        take,
      }),
    ]);

    const data = memberships.map((m) => ({
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      status: m.status,
      membershipId: m.id,
      createdAt: m.user.createdAt,
      updatedAt: m.user.updatedAt,
    }));

    return { data, meta: buildPaginationMeta(page, pageSize, total) };
  }

  // @Post("users")
  // @ApiOperation({ summary: "Create/invite a web user (Admin/Ops only)" })
  // async createUser(@Request() req: any, @Body() dto: CreateUserDto): Promise<UserDto> {
  //   const tenantId = req.tenant.tenantId;

  //   if (dto.role === Role.DRIVER) {
  //     throw new BadRequestException("Use /admin/drivers to create drivers");
  //   }

  //   const normalizeCompanyName = (name: string) =>
  //     String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

  //   const normalizeEmail = (email: string) =>
  //     String(email ?? "").trim().toLowerCase();

  //   const result = await this.prisma.$transaction(async (tx) => {
  //     // 1) Upsert internal user (public.users)
  //     const user = await tx.user.upsert({
  //       where: { email: dto.email },
  //       update: { name: dto.name ?? undefined },
  //       create: { email: dto.email, name: dto.name ?? null },
  //     });

  //     // 2) If CUSTOMER, create/upsert customer company + contact, then link to user
  //     if (dto.role === Role.CUSTOMER) {
  //       const companyName = String(dto.customerCompanyName ?? "").trim();
  //       if (!companyName) {
  //         throw new BadRequestException("customerCompanyName is required for CUSTOMER users");
  //       }

  //       const contactName = String(dto.customerContactName ?? dto.name ?? "").trim() || "Customer";
  //       const contactEmail = normalizeEmail(dto.customerContactEmail ?? dto.email);

  //       const company = await tx.customer_companies.upsert({
  //         where: {
  //           tenantId_normalizedName: {
  //             tenantId,
  //             normalizedName: normalizeCompanyName(companyName),
  //           },
  //         },
  //         update: {
  //           name: companyName,
  //         },
  //         create: {
  //           tenantId,
  //           name: companyName,
  //           normalizedName: normalizeCompanyName(companyName),
  //         },
  //         select: { id: true },
  //       });

  //       const contact = await tx.customer_contacts.upsert({
  //         where: {
  //           companyId_normalizedEmail: {
  //             companyId: company.id,
  //             normalizedEmail: contactEmail,
  //           },
  //         },
  //         update: {
  //           name: contactName,
  //           email: contactEmail,
  //         },
  //         create: {
  //           companyId: company.id,
  //           name: contactName,
  //           email: contactEmail,
  //           normalizedEmail: contactEmail,
  //         },
  //         select: { id: true },
  //       });

  //       await tx.user.update({
  //         where: { id: user.id },
  //         data: {
  //           customerCompanyId: company.id,
  //           customerContactId: contact.id,
  //         },
  //       });
  //     }

  //     // 3) Upsert membership for this tenant
  //     const membership = await tx.tenantMembership.upsert({
  //       where: { tenantId_userId: { tenantId, userId: user.id } },
  //       update: {
  //         role: dto.role,
  //         status: dto.sendInvite === false ? "Active" : "Invited",
  //       },
  //       create: {
  //         tenantId,
  //         userId: user.id,
  //         role: dto.role,
  //         status: dto.sendInvite === false ? "Active" : "Invited",
  //       },
  //     });

  //     return { user, membership };
  //   });

  //   // 4) Invite/create Supabase Auth user (outside tx)
  //   if (dto.sendInvite !== false) {
  //     const supabase = this.supabaseService.getClient();
  //     const { error } = await supabase.auth.admin.inviteUserByEmail(dto.email);
  //     if (error) {
  //       throw new BadRequestException(`Supabase invite failed: ${error.message}`);
  //     }
  //   }

  //   return {
  //     id: result.user.id,
  //     email: result.user.email,
  //     name: result.user.name,
  //     role: result.membership.role,
  //     status: result.membership.status,
  //     membershipId: result.membership.id,
  //     createdAt: result.user.createdAt,
  //     updatedAt: result.user.updatedAt,
  //   };
  // }

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

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
      },
    });

    const updatedMembership = await this.prisma.tenantMembership.update({
      where: { id: membership.id },
      data: {
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: updatedMembership.role,
      status: updatedMembership.status,
      membershipId: updatedMembership.id,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
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

    const where = { tenantId };

    const [total, vehicles] = await this.prisma.$transaction([
      this.prisma.vehicle.count({ where }),
      this.prisma.vehicle.findMany({
        where,
        orderBy: { plateNo: "asc" },
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
