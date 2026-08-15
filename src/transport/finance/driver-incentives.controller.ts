import { Controller, Get, Param, Query, Request, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { DriverTripEarningsService } from "../drivers/driver-trip-earnings.service";
import {
  DriverIncentiveDetailDto,
  DriverIncentiveListDto,
} from "./dto/driver-incentives.dto";

@ApiTags("Finance")
@ApiBearerAuth("JWT-auth")
@Controller("finance/driver-incentives")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.FINANCE)
@Roles(Role.ADMIN, Role.FINANCE)
export class DriverIncentivesController {
  constructor(private readonly tripEarnings: DriverTripEarningsService) {}

  @Get()
  @ApiOperation({
    summary:
      "Finance Driver Incentives summary for a tenant-timezone month (read-only)",
  })
  async list(
    @Request() req: any,
    @Query("month") month?: string,
    @Query("q") q?: string,
  ): Promise<DriverIncentiveListDto> {
    return this.tripEarnings.listTenantDriverIncentiveSummaries(
      req.tenant.tenantId,
      { month, q },
    );
  }

  @Get(":driverId")
  @ApiOperation({
    summary:
      "Finance Driver Incentives monthly history for one driver (read-only)",
  })
  async detail(
    @Request() req: any,
    @Param("driverId") driverId: string,
    @Query("month") month?: string,
  ): Promise<DriverIncentiveDetailDto> {
    return this.tripEarnings.getDriverIncentiveDetail(
      req.tenant.tenantId,
      driverId,
      month,
    );
  }
}
