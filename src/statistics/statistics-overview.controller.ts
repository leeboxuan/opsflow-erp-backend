import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
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
  StatisticsFiltersQueryDto,
  StatisticsOverviewDto,
} from "./dto";
import { StatisticsTenantRequest } from "./statistics.controller";
import { StatisticsOverviewService } from "./statistics-overview.service";

@ApiTags("Statistics")
@Controller("statistics")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.ADMIN, Role.TRANSPORT_STAFF, Role.FINANCE)
@ApiBearerAuth("JWT-auth")
export class StatisticsOverviewController {
  constructor(
    private readonly overviewService: StatisticsOverviewService,
  ) {}

  @Get("overview")
  @ApiOperation({ summary: "Get operational Statistics V1 overview" })
  @ApiOkResponse({ type: StatisticsOverviewDto })
  getOverview(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsFiltersQueryDto,
  ): Promise<StatisticsOverviewDto> {
    return this.overviewService.getOverview(req.tenant.tenantId, query);
  }
}
