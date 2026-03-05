import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role } from "@prisma/client";

import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../auth/guards/role.guard";

import { AdminDriversService } from "./admin-drivers.service";
import { AdminCreateDriverDto } from "./dto/admin-create-driver.dto";
import { AdminUpdateDriverDto } from "./dto/admin-update-driver.dto";
import { AdminDriverDto } from "./dto/admin-driver.dto";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto";
import type { DriverWalletDto } from "../driver/dto/driver-trip.dto";

@ApiTags("admin-drivers")
@Controller("admin/drivers")
@UseGuards(AuthGuard, TenantGuard, RoleGuard)
@Roles(Role.ADMIN, Role.OPS)
@ApiBearerAuth("JWT-auth")
export class AdminDriversController {
  constructor(private readonly adminDriversService: AdminDriversService) {}

  @Get()
  @ApiOperation({ summary: "List drivers (Admin/Ops only) — includes suspended" })
  async list(
    @Request() req: any,
    @Query() query: ListDriversQueryDto,
  ): Promise<{ data: AdminDriverDto[]; meta: { page: number; pageSize: number; total: number } }> {
    return this.adminDriversService.listDrivers(req.tenant.tenantId, query);
  }

  @Post()
  @ApiOperation({ summary: "Create driver (Admin/Ops only) — no invite" })
  async create(@Request() req: any, @Body() dto: AdminCreateDriverDto): Promise<AdminDriverDto> {
    return this.adminDriversService.createDriver(req.tenant.tenantId, dto);
  }

  @Patch(":driverId")
  @ApiOperation({ summary: "Update driver (Admin/Ops only)" })
  async update(
    @Request() req: any,
    @Param("driverId") driverId: string,
    @Body() dto: AdminUpdateDriverDto,
  ): Promise<AdminDriverDto> {
    return this.adminDriversService.updateDriver(req.tenant.tenantId, driverId, dto);
  }

  @Patch(":driverId/suspend")
  @ApiOperation({ summary: "Suspend driver (Admin/Ops only)" })
  async suspend(@Request() req: any, @Param("driverId") driverId: string) {
    return this.adminDriversService.suspendDriver(req.tenant.tenantId, driverId);
  }

  @Patch(":driverId/unsuspend")
  @ApiOperation({ summary: "Unsuspend driver (Admin/Ops only)" })
  async unsuspend(@Request() req: any, @Param("driverId") driverId: string) {
    return this.adminDriversService.unsuspendDriver(req.tenant.tenantId, driverId);
  }

  @Get(":driverId/wallet")
  @ApiOperation({ summary: "Get driver wallet (Admin/Ops only)" })
  async wallet(
    @Request() req: any,
    @Param("driverId") driverId: string,
    @Query("month") month?: string,
  ): Promise<DriverWalletDto> {
    // default to current UTC month if not supplied
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const m = month?.trim() || `${yyyy}-${mm}`;

    return this.adminDriversService.getDriverWallet(req.tenant.tenantId, driverId, m);
  }
}