import {
  Controller,
  Get,
  NotImplementedException,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../shared/auth/guards/module-entitlement.guard";
import { RoleGuard, Roles } from "../shared/auth/guards/role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import {
  StatisticsDriversDto,
  StatisticsDriversQueryDto,
  StatisticsExceptionsDto,
  StatisticsExceptionsQueryDto,
  StatisticsFiltersQueryDto,
  StatisticsFinanceDto,
  StatisticsFinanceQueryDto,
  StatisticsOverviewDto,
} from "./dto";

export type StatisticsTenantRequest = {
  tenant: {
    tenantId: string;
    role: Role;
  };
};

/**
 * Route and authorization contract reserved by WP2.
 *
 * StatisticsModule intentionally does not register this controller until WP3
 * provides the first real service. The methods must not become reachable while
 * their only safe behavior is an explicit not-implemented response.
 */
@ApiTags("Statistics")
@Controller("statistics")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.ADMIN)
@ApiBearerAuth("JWT-auth")
export class StatisticsController {
  @Get("overview")
  @ApiOperation({ summary: "Get operational Statistics V1 overview" })
  @ApiOkResponse({ type: StatisticsOverviewDto })
  getOverview(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsFiltersQueryDto,
  ): Promise<StatisticsOverviewDto> {
    return this.deferred("overview", req.tenant.tenantId, query);
  }

  @Get("drivers")
  @ApiOperation({ summary: "Get paginated Statistics V1 driver metrics" })
  @ApiOkResponse({ type: StatisticsDriversDto })
  getDrivers(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsDriversQueryDto,
  ): Promise<StatisticsDriversDto> {
    return this.deferred("drivers", req.tenant.tenantId, query);
  }

  @Get("finance")
  @RequiresTenantModule(TenantModule.FINANCE)
  @ApiOperation({ summary: "Get finance-entitled Statistics V1 metrics" })
  @ApiOkResponse({ type: StatisticsFinanceDto })
  getFinance(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsFinanceQueryDto,
  ): Promise<StatisticsFinanceDto> {
    return this.deferred("finance", req.tenant.tenantId, query);
  }

  @Get("exceptions")
  @RequiresTenantModule(TenantModule.TRANSPORT, TenantModule.FINANCE)
  @ApiOperation({ summary: "Get paginated Statistics V1 exceptions" })
  @ApiOkResponse({ type: StatisticsExceptionsDto })
  getExceptions(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsExceptionsQueryDto,
  ): Promise<StatisticsExceptionsDto> {
    return this.deferred("exceptions", req.tenant.tenantId, query);
  }

  private deferred(
    surface: string,
    tenantId: string,
    query: object,
  ): never {
    void tenantId;
    void query;
    throw new NotImplementedException(
      `Statistics ${surface} is reserved and will be activated with its real service`,
    );
  }
}
