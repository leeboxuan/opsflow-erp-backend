import { Body, Controller, Get, Param, Patch, Post, Query, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";

import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";

import { AdminDriversService } from "./admin-drivers.service";
import { AdminCreateDriverDto } from "./dto/admin-create-driver.dto";
import { AdminUpdateDriverDto } from "./dto/admin-update-driver.dto";
import { AdminDriverDto } from "./dto/admin-driver.dto";
import { ListDriversQueryDto } from "./dto/list-drivers-query.dto";
import type { DriverWalletDto } from "./dto/driver-wallet.dto";
import type {
  AdminDriverEarningsDto,
  AdminDriverEarningsTransactionDto,
  AdminDriverSummaryDto,
  AdminDriverTripHistoryItemDto,
} from "./dto/admin-driver-detail.dto";

@ApiTags("admin-drivers")
@Controller("admin/drivers")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF)
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

  @Get(":driverId/summary")
  @ApiOperation({ summary: "Driver detail summary (Admin/Ops)" })
  async summary(
    @Request() req: any,
    @Param("driverId") driverId: string,
    @Query("month") month?: string,
  ): Promise<AdminDriverSummaryDto> {
    return this.adminDriversService.getDriverSummary(
      req.tenant.tenantId,
      driverId,
      month,
    );
  }

  @Get(":driverId/trips")
  @ApiOperation({ summary: "Paginated driver trip history (Admin/Ops)" })
  async trips(
    @Request() req: any,
    @Param("driverId") driverId: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ): Promise<{
    data: AdminDriverTripHistoryItemDto[];
    meta: { page: number; pageSize: number; total: number };
  }> {
    return this.adminDriversService.listDriverTrips(req.tenant.tenantId, driverId, {
      page,
      pageSize,
    });
  }

  @Get(":driverId/earnings/transactions")
  @ApiOperation({
    summary: "Paginated driver trip-payout earnings transactions (Admin/Ops)",
  })
  async earningsTransactions(
    @Request() req: any,
    @Param("driverId") driverId: string,
    @Query("month") month?: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ): Promise<{
    data: AdminDriverEarningsTransactionDto[];
    meta: { page: number; pageSize: number; total: number };
    month: string;
    currency: string;
  }> {
    return this.adminDriversService.listDriverEarningsTransactions(
      req.tenant.tenantId,
      driverId,
      { month, page, pageSize },
    );
  }

  @Get(":driverId/earnings")
  @ApiOperation({ summary: "Driver month + lifetime earnings (Admin/Ops)" })
  async earnings(
    @Request() req: any,
    @Param("driverId") driverId: string,
    @Query("month") month?: string,
  ): Promise<AdminDriverEarningsDto> {
    return this.adminDriversService.getDriverEarnings(
      req.tenant.tenantId,
      driverId,
      month,
    );
  }

  @Patch(":driverId")
  @ApiOperation({ summary: "Update driver (Admin/Ops only)" })
  async update(
    @Request() req: any,
    @Param("driverId") driverId: string,
    @Body() dto: AdminUpdateDriverDto,
  ): Promise<AdminDriverDto> {
    return this.adminDriversService.updateDriver(
      req.tenant.tenantId,
      driverId,
      dto,
      req.user?.userId ?? null,
    );
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
