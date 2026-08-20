import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { CanonicalTenantRole, TenantModule } from "@prisma/client";
import { AuthGuard } from "../shared/auth/guards/auth.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../shared/auth/guards/module-entitlement.guard";
import { Roles } from "../shared/auth/guards/role.guard";
import { StrictCanonicalRoleGuard } from "../shared/auth/guards/strict-canonical-role.guard";
import { TenantGuard } from "../shared/auth/guards/tenant.guard";
import { StatisticsFinanceDto, StatisticsFinanceQueryDto } from "./dto";
import { StatisticsTenantRequest } from "./statistics.controller";
import { StatisticsFinanceService } from "./statistics-finance.service";

@ApiTags("Statistics")
@Controller("statistics")
@UseGuards(AuthGuard, TenantGuard, StrictCanonicalRoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.FINANCE)
@Roles(CanonicalTenantRole.TENANT_ADMIN, CanonicalTenantRole.FINANCE_ADMIN)
@ApiBearerAuth("JWT-auth")
export class StatisticsFinanceController {
  constructor(
    private readonly financeService: StatisticsFinanceService,
  ) {}

  @Get("finance")
  @ApiOperation({ summary: "Get finance-entitled Statistics V1 metrics" })
  @ApiOkResponse({ type: StatisticsFinanceDto })
  getFinance(
    @Req() req: StatisticsTenantRequest,
    @Query() query: StatisticsFinanceQueryDto,
  ): Promise<StatisticsFinanceDto> {
    return this.financeService.getFinance(req.tenant.tenantId, query);
  }
}
