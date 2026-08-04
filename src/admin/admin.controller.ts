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
import { buildOrderBy } from "../shared/common/listing/listing.sort";
import { applyQSearch } from "../shared/common/listing/listing.search";
import { CreateVehicleDto } from "./dto/create-vehicle.dto";
import { VehicleDto } from "./dto/vehicle.dto";
import { DriverLocationDto } from "../transport/drivers/location/dto/location.dto";
import { SupabaseService } from "../shared/auth/supabase.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { UserDto } from "./dto/user.dto";
import { ResetUserPasswordDto } from "./dto/reset-user-password.dto";
import { AdminListQueryDto } from "./dto/list-query.dto";
import { listTenantUsers } from "./admin-users.list";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { TenantUserProvisioningService } from "./tenant-user-provisioning.service";

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
    private readonly tenantUsers: TenantUserProvisioningService,
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
    return this.tenantUsers.createTenantUser(
      req.tenant.tenantId,
      {
        email: dto.email,
        username: dto.username,
        name: dto.name,
        phone: dto.phone,
        role: dto.role,
        sendInvite: dto.sendInvite,
        password: dto.password,
        customerCompanyName: dto.customerCompanyName,
        customerContactName: dto.customerContactName,
        customerContactEmail: dto.customerContactEmail,
      },
      { mode: "tenant-admin" },
    );
  }

  @Patch("users/:userId")
  @ApiOperation({ summary: "Update web user (Admin/Ops only)" })
  async updateUser(
    @Request() req: any,
    @Param("userId") userId: string,
    @Body() dto: UpdateUserDto,
  ): Promise<UserDto> {
    return this.tenantUsers.updateTenantUser(
      req.tenant.tenantId,
      userId,
      {
        name: dto.name,
        phone: dto.phone,
        username: dto.username,
        role: dto.role,
        status: dto.status,
      },
      { allowUsernameEdit: true },
    );
  }

  @Post("users/:userId/reset-password")
  @ApiOperation({ summary: "Admin-controlled password reset for a tenant user" })
  async resetUserPassword(
    @Request() req: any,
    @Param("userId") userId: string,
    @Body() dto: ResetUserPasswordDto,
  ) {
    return this.tenantUsers.resetTenantUserPassword(
      req.tenant.tenantId,
      userId,
      dto.password,
      { allowOfficeReset: false },
    );
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

    let confirmed = false;

    const PER_PAGE = 100;
    const MAX_PAGES = 10;
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
        const emailConfirmedAt: any =
          (found as any).email_confirmed_at ??
          (found as any).confirmed_at ??
          (found as any).user_metadata?.email_confirmed_at;

        confirmed = !!emailConfirmedAt;
        break;
      }

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
